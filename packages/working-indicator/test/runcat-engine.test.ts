import { describe, expect, test } from "vitest";
import {
  DEFAULT_TRANSITION_MS,
  type RuncatIndicatorClock,
  RuncatIndicatorEngine,
  type RuncatIndicatorScheduleHandle,
  type RuncatIndicatorSink,
} from "../src/runcat-engine.ts";

interface QueuedWake {
  fireAtMs: number;
  fn: () => void;
  cancelled: boolean;
}

class FakeClock implements RuncatIndicatorClock {
  nowMs = 0;
  queue: QueuedWake[] = [];

  now(): number {
    return this.nowMs;
  }

  schedule(delayMs: number, fn: () => void): RuncatIndicatorScheduleHandle {
    const wake: QueuedWake = {
      fireAtMs: this.nowMs + Math.max(1, delayMs),
      fn,
      cancelled: false,
    };
    this.queue.push(wake);
    return {
      cancel: () => {
        wake.cancelled = true;
      },
    };
  }

  /** Advance to the next scheduled wake and fire it. Returns true if fired. */
  fireNext(): boolean {
    const pending = this.queue.filter((w) => !w.cancelled);
    if (pending.length === 0) return false;
    pending.sort((a, b) => a.fireAtMs - b.fireAtMs);
    const next = pending[0]!;
    this.queue = this.queue.filter((w) => w !== next);
    this.nowMs = next.fireAtMs;
    next.fn();
    return true;
  }
}

class CapturingSink implements RuncatIndicatorSink {
  pushes: { frame: string; atMs: number }[] = [];

  pushFrame(frame: string): void {
    this.pushes.push({ frame, atMs: 0 });
  }
}

function makeEngine(
  frames: readonly string[] = ["a", "b", "c", "d"],
  intervalMs = 100,
  transitionMs = DEFAULT_TRANSITION_MS,
): { engine: RuncatIndicatorEngine; clock: FakeClock; sink: CapturingSink } {
  const clock = new FakeClock();
  const sink = new CapturingSink();
  const engine = new RuncatIndicatorEngine(sink, { frames, intervalMs }, clock, transitionMs);
  return { engine, clock, sink };
}

describe("RuncatIndicatorEngine — basic animation", () => {
  test("start pushes the current frame immediately and arms a wake-up", () => {
    const { engine, sink, clock } = makeEngine();
    expect(engine.isRunning()).toBe(false);
    engine.start();
    expect(engine.isRunning()).toBe(true);
    expect(sink.pushes).toHaveLength(1);
    expect(sink.pushes[0]!.frame).toBe("a");
    expect(clock.queue).toHaveLength(1);
  });

  test("advances one frame per wake-up at the stationary interval", () => {
    const { engine, clock, sink } = makeEngine();
    engine.start();
    expect(sink.pushes.map((p) => p.frame)).toEqual(["a"]);

    expect(clock.fireNext()).toBe(true);
    expect(sink.pushes.map((p) => p.frame)).toEqual(["a", "b"]);

    clock.fireNext();
    clock.fireNext();
    clock.fireNext();
    expect(sink.pushes.map((p) => p.frame)).toEqual(["a", "b", "c", "d", "a"]);
  });

  test("wake-ups are scheduled by the current effective interval", () => {
    const { engine, clock } = makeEngine();
    engine.start();
    // First wake armed at now=0 + 100 = 100.
    expect(clock.queue[0]!.fireAtMs).toBe(100);
    clock.fireNext();
    // After wake at t=100, next wake at 100 + 100 = 200.
    expect(clock.queue[0]!.fireAtMs).toBe(200);
  });

  test("stop cancels the pending wake-up and freezes animation", () => {
    const { engine, clock, sink } = makeEngine();
    engine.start();
    engine.stop();
    expect(engine.isRunning()).toBe(false);
    expect(clock.fireNext()).toBe(false);
    expect(sink.pushes).toHaveLength(1);
  });

  test("double start is a no-op (no duplicate wake-ups)", () => {
    const { engine, clock } = makeEngine();
    engine.start();
    engine.start();
    expect(clock.queue).toHaveLength(1);
  });

  test("empty frames push empty strings and do not advance index", () => {
    const { engine, sink } = makeEngine([], 100);
    engine.start();
    expect(sink.pushes[0]!.frame).toBe("");
  });
});

describe("RuncatIndicatorEngine — interval smoothing", () => {
  test("no transition when target equals current stationary interval", () => {
    const { engine } = makeEngine();
    engine.start();
    engine.setTargetInterval(100);
    expect(engine.isTransitioning()).toBe(false);
  });

  test("setTargetInterval starts a transition toward the new target", () => {
    const { engine, clock } = makeEngine();
    engine.start();
    engine.setTargetInterval(200);
    expect(engine.isTransitioning()).toBe(true);
    expect(engine.targetIntervalMs).toBe(200);
    expect(clock.queue[0]!.fireAtMs).toBe(100); // not yet changed — schedule was armed before
  });

  test("effective interval walks along the ease curve over transitionMs", () => {
    const { engine, clock } = makeEngine(["a", "b"], 100, 1000);
    engine.start();
    engine.setTargetInterval(200);

    // At t=0: still 100.
    expect(engine.snapshot().effectiveIntervalMs).toBeCloseTo(100, 5);

    // At t=500 (halfway), easeInOutCubic(0.5) = 0.5 → midpoint 150.
    clock.nowMs = 500;
    expect(engine.snapshot().effectiveIntervalMs).toBeCloseTo(150, 5);

    // At t=1000 (full), transition has completed → 200 and not transitioning.
    clock.nowMs = 1000;
    const snap = engine.snapshot();
    expect(snap.effectiveIntervalMs).toBe(200);
    expect(snap.transitioning).toBe(false);
  });

  test("transition completes lazily on the next wake-up", () => {
    const { engine, clock, sink } = makeEngine(["a", "b"], 100, 1000);
    engine.start();
    engine.setTargetInterval(200);

    // Drive many wake-ups so wall-clock crosses the transition end organically.
    let guard = 0;
    while (clock.nowMs < 1500 && clock.fireNext() && guard < 100) guard++;
    expect(engine.isTransitioning()).toBe(false);
    // After completion every wake is armed with the stationary interval 200.
    expect(clock.queue[0]!.fireAtMs - clock.nowMs).toBe(200);
    expect(sink.pushes.length).toBeGreaterThan(1);
  });

  test("mid-transition wake-ups use the smoothed interval for scheduling", () => {
    const { engine, clock } = makeEngine(["a", "b"], 100, 1000);
    engine.start();
    engine.setTargetInterval(300);

    // First wake fires at t=100 (from current effective 100).
    clock.fireNext(); // nowMs=100
    // At t=100, ease progress t=0.1 → ~0.028 → effective ≈ 100 + 200*0.028 ≈ 105.6
    // The next wake was armed with the effective interval at t=100.
    const armedAt100 = clock.queue[0]!.fireAtMs - 100;
    expect(armedAt100).toBeGreaterThan(100);
    expect(armedAt100).toBeLessThan(110);
  });

  test("retargeting mid-transition chases from the current effective interval", () => {
    const { engine, clock } = makeEngine(["a", "b"], 100, 1000);
    engine.start();
    engine.setTargetInterval(300);
    clock.nowMs = 400; // partway in, effective ≈ 100 + 200*ease(0.4)
    const beforeRetarget = engine.snapshot().effectiveIntervalMs;
    expect(beforeRetarget).toBeGreaterThan(100);
    expect(beforeRetarget).toBeLessThan(300);

    // Redirect to a smaller target while still transitioning.
    engine.setTargetInterval(150);
    expect(engine.isTransitioning()).toBe(true);
    expect(engine.targetIntervalMs).toBe(150);

    // At the new transition start (t=400), effective should equal the chased
    // value, i.e. the transition restarts cleanly from where we were.
    expect(engine.snapshot().effectiveIntervalMs).toBeCloseTo(beforeRetarget, 5);

    // It then eases toward 150 over the next transitionMs.
    clock.nowMs = 400 + 1000;
    expect(engine.snapshot().effectiveIntervalMs).toBe(150);
    expect(engine.isTransitioning()).toBe(false);
  });

  test("retarget to the same in-flight destination is a no-op", () => {
    const { engine } = makeEngine();
    engine.start();
    engine.setTargetInterval(200);
    const fromBefore = engine.snapshot().effectiveIntervalMs;
    engine.setTargetInterval(200); // same as transition target → ignored
    expect(engine.snapshot().effectiveIntervalMs).toBe(fromBefore);
  });

  test("transition direction is monotonic toward the new target", () => {
    const { engine, clock } = makeEngine(["a", "b"], 100, 1000);
    engine.start();
    engine.setTargetInterval(250);
    let last = engine.snapshot().effectiveIntervalMs;
    let monotonic = true;
    for (let t = 0; t <= 1000; t += 50) {
      clock.nowMs = t;
      const eff = engine.snapshot().effectiveIntervalMs;
      if (eff < last - 1e-6) monotonic = false;
      last = eff;
    }
    expect(monotonic).toBe(true);
  });
});

describe("RuncatIndicatorEngine — setFrames", () => {
  test("continuous rotation keeps the current frame index", () => {
    const { engine, clock, sink } = makeEngine(["a", "b", "c", "d"], 100);
    engine.start();
    // advance to frame index 2 ("c")
    sink.pushes.length = 0;
    clock.fireNext(); // -> b
    clock.fireNext(); // -> c
    expect(sink.pushes.at(-1)!.frame).toBe("c");

    // Switch to a cyclic rotation; index 2 should map to the new frame.
    engine.setFrames(["b", "c", "d", "a"]); // rotation by 1
    // setFrames while running pushes current index immediately.
    // frames[2] in the new list is "d".
    expect(sink.pushes.at(-1)!.frame).toBe("d");
  });

  test("non-cyclic change resets frame index to 0", () => {
    const { engine, clock, sink } = makeEngine(["a", "b", "c", "d"], 100);
    engine.start();
    clock.fireNext();
    clock.fireNext(); // at index 2
    engine.setFrames(["x", "y", "z", "w"]);
    expect(sink.pushes.at(-1)!.frame).toBe("x");
  });
});

describe("RuncatIndicatorEngine — sink errors do not kill the loop", () => {
  test("start arms the timer even if the first push throws", () => {
    const clock = new FakeClock();
    const sink: RuncatIndicatorSink = {
      pushFrame: () => {
        throw new Error("boom");
      },
    };
    const engine = new RuncatIndicatorEngine(sink, { frames: ["a", "b"], intervalMs: 100 }, clock);
    // start() arms the wake-up before pushing, so the throw must not strand
    // the engine in a running-but-timerless state.
    expect(() => engine.start()).toThrow();
    expect(engine.isRunning()).toBe(true);
    expect(clock.queue).toHaveLength(1); // timer armed despite the throw
  });

  test("a throwing sink on wake does not cancel subsequent wake-ups", () => {
    const clock = new FakeClock();
    let calls = 0;
    const sink: RuncatIndicatorSink = {
      pushFrame: () => {
        calls++;
        // throw on the 2nd push (the first wake after start)
        if (calls === 2) throw new Error("mid-stream boom");
      },
    };
    const engine = new RuncatIndicatorEngine(sink, { frames: ["a", "b"], intervalMs: 100 }, clock);
    engine.start(); // push #1 (calls=1)
    // wake 1: push #2 throws, but timer must still be armed
    expect(() => clock.fireNext()).toThrow();
    expect(clock.queue).toHaveLength(1);
    // wake 2: still alive (push #3, calls=3)
    expect(() => clock.fireNext()).not.toThrow();
    expect(calls).toBe(3);
  });
});

describe("RuncatIndicatorEngine — snapshot", () => {
  test("reports frame index modulo length and target interval", () => {
    const { engine, clock } = makeEngine(["a", "b", "c"], 100);
    engine.start();
    clock.fireNext();
    clock.fireNext();
    clock.fireNext(); // back to 0
    const snap = engine.snapshot();
    expect(snap.frameIndex).toBe(0);
    expect(snap.frame).toBe("a");
    expect(snap.targetIntervalMs).toBe(100);
    expect(snap.transitioning).toBe(false);
  });
});
