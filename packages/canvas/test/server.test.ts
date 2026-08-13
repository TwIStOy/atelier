import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CanvasServer, SSE_PATH } from "../src/server.ts";
import { PageStore } from "../src/store.ts";

function sseReader(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async readUntil(marker: string, deadlineMs: number): Promise<string> {
      const deadline = Date.now() + deadlineMs;
      while (!buffer.includes(marker)) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        let timeout: NodeJS.Timeout | undefined;
        const result = await Promise.race([
          reader.read(),
          new Promise<null>((resolve) => {
            timeout = setTimeout(() => resolve(null), remaining);
          }),
        ]);
        clearTimeout(timeout);
        if (result === null || result.done) break;
        buffer += decoder.decode(result.value);
      }
      return buffer;
    },
    async close(): Promise<void> {
      await reader.cancel().catch(() => {});
    },
  };
}

describe("CanvasServer", () => {
  let dir: string;
  let store: PageStore;
  let server: CanvasServer;
  let base: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "canvas-server-"));
    store = new PageStore(dir);
    server = new CanvasServer({ store, preferredPort: 0 });
    const port = await server.start();
    base = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves a published page with base style and live-reload injected", async () => {
    store.upsert("dash", "<!DOCTYPE html><html><head><title>t</title></head><body><h1>hi</h1></body></html>");
    const res = await fetch(`${base}/p/dash`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<h1>hi</h1>");
    expect(body).toContain(`EventSource("${SSE_PATH}")`);
    expect(body).toContain('d.name==="dash"');
    expect(body.indexOf("<script>")).toBeLessThan(body.indexOf("</body>"));
  });

  it("injects the base stylesheet at the top of <head> so page styles can override", async () => {
    store.upsert("styled", '<html><head><style id="mine">body{color:red}</style></head><body>x</body></html>');
    const body = await (await fetch(`${base}/p/styled`)).text();
    expect(body).toContain('id="pi-canvas-base"');
    expect(body).toContain("--canvas-bg");
    expect(body).toContain("--canvas-series-1");
    expect(body).toContain(".card{");
    expect(body).toContain(".pill-danger{");
    expect(body.indexOf('id="pi-canvas-base"')).toBeLessThan(body.indexOf('id="mine"'));
  });

  it("serves the vendored chart libraries", async () => {
    const echarts = await fetch(`${base}/lib/echarts.min.js`);
    expect(echarts.status).toBe(200);
    expect(echarts.headers.get("content-type")).toContain("text/javascript");
    expect((await echarts.text()).length).toBeGreaterThan(100_000);

    const wrapper = await fetch(`${base}/lib/canvas.js`);
    expect(wrapper.status).toBe(200);
    expect(await wrapper.text()).toContain("window.PiCanvas");

    expect((await fetch(`${base}/lib/nope.js`)).status).toBe(404);
    expect((await fetch(`${base}/lib/../secret`)).status).toBe(404);
  });

  it("prepends the base style when the page has no <head>", async () => {
    store.upsert("frag", "<h1>fragment</h1>");
    const body = await (await fetch(`${base}/p/frag`)).text();
    expect(body.startsWith('<style id="pi-canvas-base">')).toBe(true);
    expect(body.endsWith("</script>")).toBe(true);
  });

  it("returns 404 for unknown pages and routes", async () => {
    expect((await fetch(`${base}/p/missing`)).status).toBe(404);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it("serves an index listing pages, reloading on any change", async () => {
    store.upsert("dash", "<html>x</html>");
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<a href="/p/dash">dash</a>');
    expect(body).toContain('id="pi-canvas-base"');
    expect(body).toContain(`EventSource("${SSE_PATH}")`);
    expect(body).not.toContain('d.name==="dash"');
  });

  it("pushes SSE changed events to connected clients", async () => {
    const res = await fetch(`${base}${SSE_PATH}`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    server.notifyChanged("dash");

    const sse = sseReader(res);
    const received = await sse.readUntil("event: changed", 2000);
    await sse.close();
    expect(received).toContain("event: changed");
    expect(received).toContain('"name":"dash"');
  });

  it("restarts after stop", async () => {
    await server.stop();
    expect(server.running).toBe(false);
    const port = await server.start();
    expect(port).toBeGreaterThan(0);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
  });
});
