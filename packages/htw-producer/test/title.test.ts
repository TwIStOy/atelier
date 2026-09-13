import { beforeEach, describe, expect, test, vi } from "vitest";

type Handler = (...args: unknown[]) => unknown;

let sharedTitle = "";
const titleListeners: Array<(title: string) => void> = [];
const postedEvents: unknown[] = [];

vi.mock("@htwang-contrib/common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@htwang-contrib/common")>();
  return {
    ...actual,
    getSessionTitle: vi.fn(() => sharedTitle),
    onSessionTitle: vi.fn((listener: (title: string) => void) => {
      titleListeners.push(listener);
      return () => {};
    }),
    ensureSessionTitle: vi.fn(async () => {}),
    captureSessionFirstPrompt: vi.fn(),
    resetSessionTitle: vi.fn(() => {}),
    initSessionTitleService: vi.fn(),
  };
});

vi.mock("../src/client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/client.ts")>();
  return {
    ...actual,
    postEvent: vi.fn(async (_host: string, _port: number, envelope: unknown) => {
      postedEvents.push(envelope);
      return { ok: true };
    }),
    postReport: vi.fn(async () => ({ ok: true })),
  };
});

vi.mock("../src/config.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.ts")>();
  return {
    ...actual,
    loadConfig: () => ({ enabled: true, host: "127.0.0.1", port: 7482 }),
  };
});

import { buildEnvelope } from "../src/event.ts";
import htwProducer from "../src/index.ts";
import { buildReport, deriveTitle } from "../src/report.ts";
import { mockCtx } from "./helpers.ts";

function latchSharedTitle(title: string): void {
  sharedTitle = title;
  for (const listener of [...titleListeners]) listener(title);
}

describe("deriveTitle", () => {
  beforeEach(() => {
    sharedTitle = "";
  });

  test("session name wins over the generated title", () => {
    sharedTitle = "Generated";
    expect(deriveTitle(mockCtx({ sessionName: "Named session" }))).toBe("Named session");
  });

  test("the shared generated title beats the prompt fallback", () => {
    sharedTitle = "Generated title";
    const ctx = mockCtx({ branch: [{ type: "message", message: { role: "user", content: "fix the bug" } }] });
    expect(deriveTitle(ctx)).toBe("Generated title");
  });

  test("falls back to the first prompt until a title is generated", () => {
    const ctx = mockCtx({ branch: [{ type: "message", message: { role: "user", content: "fix the bug" } }] });
    expect(deriveTitle(ctx)).toBe("fix the bug");
  });
});

describe("title on the wire", () => {
  beforeEach(() => {
    sharedTitle = "";
  });

  test("snapshot and event envelopes carry the shared title once latched", () => {
    const ctx = mockCtx();
    const diff = { add: 0, delete: 0 };
    const gitCache = { get: () => ({ project: "p" }) } as unknown as Parameters<typeof buildEnvelope>[0]["gitCache"];

    sharedTitle = "Fix the failing test";
    const report = buildReport({
      ctx,
      id: "pi/s",
      startedAt: 1,
      status: "working",
      diff,
      gitCache,
    });
    expect(report.title).toBe("Fix the failing test");

    const envelope = buildEnvelope({
      ctx,
      sessionId: "s",
      startedAt: 1,
      event: { type: "turn_completed" },
      diff,
      gitCache,
    });
    expect(envelope.title).toBe("Fix the failing test");
  });
});

describe("title_changed emission", () => {
  beforeEach(() => {
    sharedTitle = "";
    titleListeners.length = 0;
    postedEvents.length = 0;
  });

  test("a latched shared title pushes a title_changed event", async () => {
    const handlers = new Map<string, Handler>();
    const pi = {
      on: (event: string, handler: Handler) => {
        handlers.set(event, handler);
      },
    };
    htwProducer(pi as never);
    const ctx = mockCtx();

    handlers.get("session_start")!({}, ctx);
    handlers.get("before_agent_start")!({ prompt: "fix the failing test" }, ctx);
    expect(titleListeners.length).toBeGreaterThan(0);

    postedEvents.length = 0;
    latchSharedTitle("Fix the failing test");
    await new Promise((r) => setTimeout(r, 10));

    const titleEvents = postedEvents.filter((e) => (e as { event: { type: string } }).event.type === "title_changed");
    expect(titleEvents.length).toBe(1);
    expect((titleEvents[0] as { title?: string }).title).toBe("Fix the failing test");

    handlers.get("session_shutdown")!({}, ctx);
  });

  test("no title_changed after the session ended", async () => {
    const handlers = new Map<string, Handler>();
    const pi = {
      on: (event: string, handler: Handler) => {
        handlers.set(event, handler);
      },
    };
    htwProducer(pi as never);
    const ctx = mockCtx();

    handlers.get("session_start")!({}, ctx);
    handlers.get("session_shutdown")!({}, ctx);
    postedEvents.length = 0;
    latchSharedTitle("Late title");
    await new Promise((r) => setTimeout(r, 10));
    expect(postedEvents.filter((e) => (e as { event: { type: string } }).event.type === "title_changed")).toEqual([]);
  });
});
