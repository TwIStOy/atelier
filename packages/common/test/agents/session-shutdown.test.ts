import { describe, expect, it, vi } from "vitest";
import { shutdownChildSession } from "../../src/agents/session-shutdown.ts";

function makeSession(over: { hasHandlers?: boolean; emit?: () => Promise<unknown> }) {
  const calls: string[] = [];
  const runner = {
    hasHandlers: vi.fn(() => over.hasHandlers ?? false),
    emit: vi.fn(async () => {
      calls.push("emit");
      await over.emit?.();
      return {};
    }),
  };
  const session = {
    extensionRunner: runner,
    dispose: vi.fn(() => {
      calls.push("dispose");
    }),
  };
  return { session, runner, calls };
}

describe("shutdownChildSession", () => {
  it("is a no-op for an undefined session", async () => {
    await expect(shutdownChildSession(undefined)).resolves.toBeUndefined();
  });

  it("emits session_shutdown before dispose when handlers are bound", async () => {
    const { session, runner, calls } = makeSession({ hasHandlers: true });
    await shutdownChildSession(session as never);
    expect(runner.emit).toHaveBeenCalledWith({ type: "session_shutdown", reason: "quit" });
    expect(calls).toEqual(["emit", "dispose"]);
  });

  it("skips the emit when no session_shutdown handler is bound", async () => {
    const { session, runner, calls } = makeSession({ hasHandlers: false });
    await shutdownChildSession(session as never);
    expect(runner.emit).not.toHaveBeenCalled();
    expect(calls).toEqual(["dispose"]);
  });

  it("still disposes when the emit rejects", async () => {
    const { session, calls } = makeSession({
      hasHandlers: true,
      emit: () => Promise.reject(new Error("handler blew up")),
    });
    await shutdownChildSession(session as never);
    expect(calls).toEqual(["emit", "dispose"]);
  });

  it("still disposes when a handler hangs past the timeout", async () => {
    vi.useFakeTimers();
    try {
      const { session, calls } = makeSession({
        hasHandlers: true,
        emit: () => new Promise(() => {}),
      });
      const done = shutdownChildSession(session as never);
      await vi.advanceTimersByTimeAsync(3_100);
      await done;
      expect(calls).toEqual(["emit", "dispose"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("swallows a dispose throw", async () => {
    const session = {
      extensionRunner: { hasHandlers: () => false },
      dispose: () => {
        throw new Error("dispose failed");
      },
    };
    await expect(shutdownChildSession(session as never)).resolves.toBeUndefined();
  });
});
