import { type FSWatcher, mkdirSync, watch } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { type CanvasPage, type PageStore, pageNameFromFile } from "./store.ts";

export interface CanvasServerOptions {
  store: PageStore;
  preferredPort: number;
  host?: string;
  maxPortAttempts?: number;
}

export const SSE_PATH = "/__canvas/events";

const HEARTBEAT_MS = 25_000;
const WATCH_DEBOUNCE_MS = 120;

const BASE_STYLE = `<style id="pi-canvas-base">:root{
--canvas-bg:#14161a;
--canvas-surface:#1c1f26;
--canvas-fg:#d6d8dd;
--canvas-muted:#8a8f99;
--canvas-accent:#7aa2f7;
--canvas-border:#2a2e37;
}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;padding:2rem 1.5rem;background:var(--canvas-bg);color:var(--canvas-fg);font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.5;font-size:15px}
h1{font-size:1.4rem;margin:0 0 1rem}
h2{font-size:1.15rem;margin:1.5rem 0 .6rem}
h3{font-size:1rem;margin:1.2rem 0 .5rem}
a{color:var(--canvas-accent);text-decoration:none}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid var(--canvas-border)}
th{color:var(--canvas-muted);font-weight:600}
code{font-family:ui-monospace,monospace;background:var(--canvas-surface);padding:.1rem .3rem;border-radius:4px;font-size:.88em}
pre{font-family:ui-monospace,monospace;background:var(--canvas-surface);padding:.8rem 1rem;border-radius:6px;overflow-x:auto}
pre code{background:none;padding:0}
hr{border:none;border-top:1px solid var(--canvas-border);margin:1.5rem 0}
</style>`;

function liveReloadSnippet(pageName: string | null): string {
  const condition = pageName === null ? "true" : `d.name===${JSON.stringify(pageName)}`;
  return `<script>(()=>{const es=new EventSource(${JSON.stringify(SSE_PATH)});es.addEventListener("changed",(e)=>{let d={};try{d=JSON.parse(e.data)}catch{d={}}if(d.name==="*"||${condition})location.reload()})})();</script>`;
}

// Injected at the top of <head> so a page's own stylesheets come later and can
// override the base theme.
function injectBaseStyle(html: string): string {
  if (html.includes('id="pi-canvas-base"')) return html;
  const headMatch = /<head[^>]*>/i.exec(html);
  if (headMatch) {
    const idx = headMatch.index + headMatch[0].length;
    return html.slice(0, idx) + BASE_STYLE + html.slice(idx);
  }
  return BASE_STYLE + html;
}

function injectLiveReload(html: string, pageName: string): string {
  const snippet = liveReloadSnippet(pageName);
  const idx = html.toLowerCase().lastIndexOf("</body>");
  if (idx === -1) return html + snippet;
  return html.slice(0, idx) + snippet + html.slice(idx);
}

function renderIndex(pages: CanvasPage[]): string {
  const items = pages
    .map(
      (p) =>
        `<li><a href="/p/${p.name}">${p.name}</a> <span class="t">${new Date(p.updatedAt).toLocaleString()}</span></li>`,
    )
    .join("\n");
  const body = pages.length === 0 ? "<p>No pages yet. Ask the agent to publish one.</p>" : `<ul>\n${items}\n</ul>`;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>pi canvas</title>
<style>
body{max-width:720px}
ul{padding-left:1.2rem;list-style:none}
li{margin:.4rem 0}
.t{color:var(--canvas-muted);font-size:.85rem;margin-left:.5rem}
</style>
</head>
<body>
<h1>pi canvas</h1>
${body}
${liveReloadSnippet(null)}
</body>
</html>`;
}

export function externalIPv4Addresses(): string[] {
  const result: string[] = [];
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal) {
        result.push(info.address);
      }
    }
  }
  return result;
}

export class CanvasServer {
  private server: Server | null = null;
  private readonly clients = new Set<ServerResponse>();
  private heartbeat: NodeJS.Timeout | null = null;
  private watcher: FSWatcher | null = null;
  private readonly pendingWatchTimers = new Map<string, NodeJS.Timeout>();
  private actualPort = 0;

  constructor(private readonly options: CanvasServerOptions) {}

  get port(): number {
    return this.actualPort;
  }

  get running(): boolean {
    return this.server !== null;
  }

  async start(): Promise<number> {
    if (this.server) return this.actualPort;
    const host = this.options.host ?? "0.0.0.0";
    const attempts = this.options.maxPortAttempts ?? 20;
    let lastError: unknown = null;
    for (let i = 0; i < attempts; i++) {
      try {
        this.actualPort = await this.listen(this.options.preferredPort + i, host);
        this.heartbeat = setInterval(() => this.broadcastRaw(": hb\n\n"), HEARTBEAT_MS);
        this.heartbeat.unref();
        this.startWatcher();
        return this.actualPort;
      } catch (err) {
        lastError = err;
        if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async stop(): Promise<void> {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.pendingWatchTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingWatchTimers.clear();
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();
    const srv = this.server;
    this.server = null;
    if (!srv) return;
    await new Promise<void>((resolve) => {
      srv.close(() => resolve());
    });
  }

  notifyChanged(name: string): void {
    this.broadcastRaw(`event: changed\ndata: ${JSON.stringify({ name })}\n\n`);
  }

  private broadcastRaw(payload: string): void {
    for (const client of this.clients) {
      client.write(payload);
    }
  }

  private startWatcher(): void {
    const dir = this.options.store.dir;
    try {
      mkdirSync(dir, { recursive: true });
      this.watcher = watch(dir, (_event, filename) => {
        if (!filename) return;
        const name = pageNameFromFile(filename.toString());
        if (!name || this.options.store.recentlyWritten(name)) return;
        this.scheduleDiskNotify(name);
      });
    } catch {
      this.watcher = null;
    }
  }

  private scheduleDiskNotify(name: string): void {
    const existing = this.pendingWatchTimers.get(name);
    if (existing) clearTimeout(existing);
    this.pendingWatchTimers.set(
      name,
      setTimeout(() => {
        this.pendingWatchTimers.delete(name);
        if (this.options.store.recentlyWritten(name)) return;
        this.notifyChanged(name);
      }, WATCH_DEBOUNCE_MS),
    );
  }

  private listen(port: number, host: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = createServer((req, res) => this.handleRequest(req, res));
      srv.once("error", reject);
      srv.listen(port, host, () => {
        srv.off("error", reject);
        this.server = srv;
        const addr = srv.address();
        resolve(typeof addr === "object" && addr !== null ? addr.port : port);
      });
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === SSE_PATH) {
      this.handleSse(res);
      return;
    }
    if (url.pathname === "/") {
      this.sendHtml(res, injectBaseStyle(renderIndex(this.options.store.list())));
      return;
    }
    const match = /^\/p\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})$/.exec(url.pathname);
    if (match) {
      const page = this.options.store.get(match[1]);
      if (page) {
        this.sendHtml(res, injectLiveReload(injectBaseStyle(page.html), page.name));
        return;
      }
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }

  private handleSse(res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(": connected\n\n");
    this.clients.add(res);
    res.on("close", () => {
      this.clients.delete(res);
    });
  }

  private sendHtml(res: ServerResponse, html: string): void {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  }
}
