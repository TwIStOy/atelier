import { describe, expect, test } from "vitest";
import { postEvent, postReport, type RequestFn } from "../src/client.ts";
import type { EventEnvelope } from "../src/event.ts";
import type { Report } from "../src/report.ts";

const REPORT: Report = {
  id: "x",
  project: "/srv/repo/.git",
  cwd: "/srv/repo",
  model: "m",
  status: "idle",
  context: { percent: 0 },
  diff: { add: 0, delete: 0 },
};

const ENVELOPE: EventEnvelope = {
  harness: "pi",
  session_id: "abc123",
  cwd: "/srv/repo",
  event: { type: "turn_completed" },
};

interface FakeReq {
  handlers: Record<string, ((arg?: unknown) => void)[]>;
  written: string[];
  ended: boolean;
  destroyed: boolean;
  timeoutMs?: number;
}

function makeRequestFn(): {
  fn: RequestFn;
  req: FakeReq;
  respond: (status: number) => void;
  options: () => Record<string, unknown> | undefined;
} {
  const req: FakeReq = { handlers: {}, written: [], ended: false, destroyed: false };
  let captured: ((status: number) => void) | undefined;
  let capturedOptions: Record<string, unknown> | undefined;
  const fn = ((options, callback) => {
    capturedOptions = options as Record<string, unknown>;
    captured = (status) => callback({ statusCode: status });
    return {
      on(event: string, handler: (arg?: unknown) => void) {
        let list = req.handlers[event];
        if (!list) {
          list = [];
          req.handlers[event] = list;
        }
        list.push(handler);
        return this;
      },
      write(chunk: string) {
        req.written.push(chunk);
        return this;
      },
      end() {
        req.ended = true;
        return this;
      },
      setTimeout(ms: number) {
        req.timeoutMs = ms;
        return this;
      },
      destroy(err?: unknown) {
        req.destroyed = true;
        const handler = req.handlers.error?.[0];
        if (handler) handler(err instanceof Error ? err : new Error("destroyed"));
        return this;
      },
    };
  }) as RequestFn;
  return { fn, req, respond: (status) => captured?.(status), options: () => capturedOptions };
}

describe("postEvent", () => {
  test("targets /v1/events with the envelope body", async () => {
    const { fn, req, respond, options } = makeRequestFn();
    const promise = postEvent("127.0.0.1", 7482, ENVELOPE, { requestFn: fn });
    expect(options()?.path).toBe("/v1/events");
    expect(options()?.method).toBe("POST");
    expect(req.written[0]).toBe(JSON.stringify(ENVELOPE));
    respond(204);
    await expect(promise).resolves.toEqual({ ok: true, statusCode: 204 });
  });

  test("resolves ok=false on 400 schema rejection", async () => {
    const { fn, respond } = makeRequestFn();
    const promise = postEvent("127.0.0.1", 7482, ENVELOPE, { requestFn: fn });
    respond(400);
    await expect(promise).resolves.toEqual({ ok: false, statusCode: 400 });
  });
});

describe("postReport", () => {
  test("writes JSON body, ends request, resolves ok on 204", async () => {
    const { fn, req, respond } = makeRequestFn();
    const promise = postReport("127.0.0.1", 7482, REPORT, { requestFn: fn });
    expect(req.written[0]).toBe(JSON.stringify(REPORT));
    expect(req.ended).toBe(true);
    respond(204);
    await expect(promise).resolves.toEqual({ ok: true, statusCode: 204 });
  });

  test("resolves ok=false on non-204 status", async () => {
    const { fn, respond } = makeRequestFn();
    const promise = postReport("127.0.0.1", 7482, REPORT, { requestFn: fn });
    respond(500);
    await expect(promise).resolves.toEqual({ ok: false, statusCode: 500 });
  });

  test("resolves ok=false with error message on socket error (daemon down)", async () => {
    const { fn, req } = makeRequestFn();
    const promise = postReport("127.0.0.1", 7482, REPORT, { requestFn: fn });
    req.handlers.error[0]?.(new Error("connect ECONNREFUSED"));
    await expect(promise).resolves.toMatchObject({ ok: false, error: "connect ECONNREFUSED" });
  });

  test("resolves ok=false on timeout by destroying the socket", async () => {
    const { fn, req } = makeRequestFn();
    const promise = postReport("127.0.0.1", 7482, REPORT, { requestFn: fn });
    req.handlers.timeout[0]?.();
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(req.destroyed).toBe(true);
  });

  test("never rejects even if requestFn throws synchronously", async () => {
    const fn = (() => {
      throw new Error("nope");
    }) as RequestFn;
    await expect(postReport("127.0.0.1", 7482, REPORT, { requestFn: fn })).resolves.toMatchObject({
      ok: false,
      error: "nope",
    });
  });

  test("never rejects when write throws", async () => {
    const fn = ((_options) => ({
      on() {
        return this;
      },
      write() {
        throw new Error("write boom");
      },
      end() {
        return this;
      },
      setTimeout() {
        return this;
      },
      destroy() {
        return this;
      },
    })) as RequestFn;
    await expect(postReport("127.0.0.1", 7482, REPORT, { requestFn: fn })).resolves.toMatchObject({
      ok: false,
      error: "write boom",
    });
  });
});
