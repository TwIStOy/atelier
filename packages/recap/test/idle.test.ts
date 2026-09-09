import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdleListener } from "../src/idle.ts";

interface ProbeCtx {
  idle: boolean;
  editor: string;
}

function makeCtx(idle: boolean, editor = ""): ProbeCtx {
  return { idle, editor };
}

const IDLE_MS = 60_000;
const POLL_MS = 1_000;

describe("IdleListener", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enters idle after idleMs without state changes", () => {
    const onEnter = vi.fn();
    const listener = new IdleListener<ProbeCtx>((c) => `idle:${c.idle};editor:${c.editor}`, {
      idleMs: IDLE_MS,
      pollMs: POLL_MS,
    });
    listener.on("enter", onEnter);

    const ctx = makeCtx(true);
    listener.watch(ctx);
    expect(onEnter).not.toHaveBeenCalled();

    vi.advanceTimersByTime(IDLE_MS - 1);
    expect(onEnter).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEnter).toHaveBeenCalledWith(ctx);
  });

  it("restarts the timer when the state hash changes", () => {
    const onEnter = vi.fn();
    const listener = new IdleListener<ProbeCtx>((c) => `idle:${c.idle};editor:${c.editor}`, {
      idleMs: IDLE_MS,
      pollMs: POLL_MS,
    });
    listener.on("enter", onEnter);

    const ctx = makeCtx(true, "");
    listener.watch(ctx);

    vi.advanceTimersByTime(IDLE_MS - 2 * POLL_MS);
    ctx.editor = "user is typing";
    vi.advanceTimersByTime(POLL_MS);

    vi.advanceTimersByTime(IDLE_MS - 1);
    expect(onEnter).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("does not re-enter while already idle", () => {
    const onEnter = vi.fn();
    const listener = new IdleListener(() => true, { idleMs: IDLE_MS, pollMs: POLL_MS });
    listener.on("enter", onEnter);

    listener.watch(makeCtx(true));
    vi.advanceTimersByTime(IDLE_MS);
    expect(onEnter).toHaveBeenCalledTimes(1);

    listener.enter(makeCtx(true));
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("wakes on activity, fires wake callbacks, and stops watching", () => {
    const onEnter = vi.fn();
    const onWake = vi.fn();
    const listener = new IdleListener(() => true, { idleMs: IDLE_MS, pollMs: POLL_MS });
    listener.on("enter", onEnter);
    listener.on("wake", onWake);

    const ctx = makeCtx(true);
    listener.watch(ctx);

    vi.advanceTimersByTime(10_000);
    listener.wake(ctx);
    expect(onWake).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("fires wake callbacks even when already active", () => {
    const onWake = vi.fn();
    const listener = new IdleListener(() => true, { idleMs: IDLE_MS, pollMs: POLL_MS });
    listener.on("wake", onWake);

    listener.wake(makeCtx(true));
    listener.wake(makeCtx(true));
    expect(onWake).toHaveBeenCalledTimes(2);
  });

  it("watch after wake starts watching again", () => {
    const onEnter = vi.fn();
    const listener = new IdleListener(() => true, { idleMs: IDLE_MS, pollMs: POLL_MS });
    listener.on("enter", onEnter);

    const ctx = makeCtx(true);
    listener.watch(ctx);
    listener.wake(ctx);
    listener.watch(ctx);

    vi.advanceTimersByTime(IDLE_MS);
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("dispose clears timers and callbacks", () => {
    const onEnter = vi.fn();
    const onWake = vi.fn();
    const listener = new IdleListener(() => true, { idleMs: IDLE_MS, pollMs: POLL_MS });
    listener.on("enter", onEnter);
    listener.on("wake", onWake);

    listener.watch(makeCtx(true));
    listener.dispose();

    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(onEnter).not.toHaveBeenCalled();

    listener.wake(makeCtx(true));
    expect(onWake).not.toHaveBeenCalled();
  });

  it("clamps the idle timeout to the 5s minimum", () => {
    const onEnter = vi.fn();
    const listener = new IdleListener(() => true, { idleMs: 1, pollMs: 10 });
    listener.on("enter", onEnter);

    listener.watch(makeCtx(true));
    vi.advanceTimersByTime(4_999);
    expect(onEnter).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onEnter).toHaveBeenCalledTimes(1);
  });
});
