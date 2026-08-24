import { describe, expect, test } from "vitest";
import { sessionIdFromCtx, sessionIdFromEventCtx } from "../src/session-id.ts";

describe("sessionIdFromCtx", () => {
  test("prefers the Pi session ID over the session file", () => {
    expect(
      sessionIdFromCtx({
        sessionManager: {
          getSessionId: () => "session-uuid",
          getSessionFile: () => "/tmp/session.jsonl",
        },
      }),
    ).toBe("session-uuid");
  });

  test("falls back to the session file", () => {
    expect(
      sessionIdFromCtx({
        sessionManager: {
          getSessionFile: () => "/tmp/session.jsonl",
        },
      }),
    ).toBe("/tmp/session.jsonl");
  });
});

describe("sessionIdFromEventCtx", () => {
  test("prefers the Pi session ID over event and file IDs", () => {
    expect(
      sessionIdFromEventCtx(
        { session_id: "event-session" },
        {
          sessionManager: {
            getSessionId: () => "session-uuid",
            getSessionFile: () => "/tmp/session.jsonl",
          },
        },
      ),
    ).toBe("session-uuid");
  });

  test("falls back through event, file, cwd, and default IDs", () => {
    expect(
      sessionIdFromEventCtx(
        { session_id: "event-session" },
        { sessionManager: { getSessionFile: () => "/tmp/session.jsonl" } },
      ),
    ).toBe("event-session");
    expect(sessionIdFromEventCtx({}, { sessionManager: { getSessionFile: () => "/tmp/session.jsonl" } })).toBe(
      "/tmp/session.jsonl",
    );
    expect(sessionIdFromEventCtx({}, { cwd: "/tmp/project" })).toBe("/tmp/project");
    expect(sessionIdFromEventCtx({}, {})).toBe("pi");
  });

  test("continues when session manager accessors throw", () => {
    expect(
      sessionIdFromEventCtx(
        { sessionId: "event-session" },
        {
          sessionManager: {
            getSessionId: () => {
              throw new Error("stale");
            },
            getSessionFile: () => {
              throw new Error("stale");
            },
          },
        },
      ),
    ).toBe("event-session");
  });
});
