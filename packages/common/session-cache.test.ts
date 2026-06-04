import { describe, expect, test } from "vitest";
import {
  branchToMessages,
  createSessionCache,
  isStaleCtxError,
} from "./session-cache.ts";
import { clearGlobalState } from "./global-state.ts";

const STALE_MESSAGE =
  "This extension ctx is stale after session replacement or reload. " +
  "Do not use a captured pi or command ctx after ctx.newSession().";

function mockCtx(
  opts: { sessionFile?: string | null; sessionId?: string } = {},
) {
  return {
    sessionManager: {
      getSessionFile: () => opts.sessionFile ?? "/tmp/test-session.jsonl",
      getSessionId: () => opts.sessionId ?? "test-id",
    },
  } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;
}

describe("isStaleCtxError", () => {
  test("matches the stale-ctx substring", () => {
    expect(isStaleCtxError(new Error(STALE_MESSAGE))).toBe(true);
  });

  test("does not match unrelated errors", () => {
    expect(isStaleCtxError(new Error("something else"))).toBe(false);
  });

  test("handles non-Error values", () => {
    expect(isStaleCtxError("stale after session replacement")).toBe(true);
    expect(isStaleCtxError(42)).toBe(false);
    expect(isStaleCtxError(null)).toBe(false);
  });
});

describe("branchToMessages", () => {
  test("filters to message entries and converts", () => {
    const branch = [
      {
        type: "message",
        message: { role: "user", content: "hi", timestamp: 0 },
      },
      { type: "tool_call", id: "t1" },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
          timestamp: 0,
        },
      },
    ];

    const messages = branchToMessages(
      branch as unknown as import("@earendil-works/pi-coding-agent").SessionEntry[],
    );
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0]).toMatchObject({ role: "user" });
  });
});

describe("createSessionCache", () => {
  const testKey = "test-session-cache-unit";

  test("get returns undefined before set", () => {
    clearGlobalState(testKey);
    const cache = createSessionCache<string>(testKey);
    expect(cache.get(mockCtx())).toBeUndefined();
  });

  test("set/get round-trip", () => {
    clearGlobalState(testKey);
    const cache = createSessionCache<string>(testKey);
    const ctx = mockCtx();
    cache.set(ctx, "hello");
    expect(cache.get(ctx)).toBe("hello");
  });

  test("invalidate removes the cached value", () => {
    clearGlobalState(testKey);
    const cache = createSessionCache<string>(testKey);
    const ctx = mockCtx();
    cache.set(ctx, "hello");
    cache.invalidate(ctx);
    expect(cache.get(ctx)).toBeUndefined();
  });

  test("entries are isolated by session file", () => {
    clearGlobalState(testKey);
    const cache = createSessionCache<string>(testKey);
    const ctx1 = mockCtx({ sessionFile: "/tmp/a.jsonl" });
    const ctx2 = mockCtx({ sessionFile: "/tmp/b.jsonl" });
    cache.set(ctx1, "one");
    cache.set(ctx2, "two");
    expect(cache.get(ctx1)).toBe("one");
    expect(cache.get(ctx2)).toBe("two");
    cache.invalidate(ctx1);
    expect(cache.get(ctx1)).toBeUndefined();
    expect(cache.get(ctx2)).toBe("two");
  });

  test("uses memory:<sessionId> fallback when sessionFile is null", () => {
    clearGlobalState(testKey);
    const cache = createSessionCache<string>(testKey);
    const ctx = mockCtx({
      sessionFile: null,
      sessionId: "abc",
    });
    cache.set(ctx, "fallback");
    expect(cache.get(ctx)).toBe("fallback");
  });

  test("safeInvalidate swallows stale-ctx error", () => {
    clearGlobalState(testKey);
    const cache = createSessionCache<string>(testKey);
    const staleCtx = {
      get sessionManager() {
        throw new Error(STALE_MESSAGE);
      },
    } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;
    expect(() => cache.safeInvalidate(staleCtx)).not.toThrow();
  });

  test("safeInvalidate re-throws non-stale errors", () => {
    clearGlobalState(testKey);
    const cache = createSessionCache<string>(testKey);
    const boomCtx = {
      get sessionManager() {
        throw new Error("boom: real bug");
      },
    } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;
    expect(() => cache.safeInvalidate(boomCtx)).toThrow("boom");
  });
});
