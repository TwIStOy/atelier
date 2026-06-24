/**
 * RuncatIndicatorEngine
 *
 * For the runcat (speed-adaptive) spinner we cannot rely on pi's built-in
 * Loader animation: the Loader always restarts its own `setInterval` from
 * frame 0 whenever `setIndicator` is called, so every speed change would
 * snap the animation back to the first frame.
 *
 * Instead we drive the animation ourselves. Each wake-up we push a single
 * frame (`{ frames: [currentFrame] }`) into pi. The Loader short-circuits
 * its own timer when `frames.length <= 1`, so we become the sole driver.
 *
 * Interval transitions are smoothed over `TRANSITION_MS` (1s) using an
 * ease-in-out curve, so the cat does not lurch when the target interval
 * changes between quantized buckets. Re-targeting mid-transition restarts
 * the ease from the *current effective* interval (chase), never from the
 * stale stationary target.
 */

export interface RuncatIndicatorSink {
  /** Push a single frame; pi's Loader will not animate a 1-length list. */
  pushFrame(frame: string): void;
}

export interface RuncatIndicatorScheduleHandle {
  cancel(): void;
}

export interface RuncatIndicatorClock {
  now(): number;
  schedule(delayMs: number, fn: () => void): RuncatIndicatorScheduleHandle;
}

const REAL_NOW = () => Date.now();

class RealScheduleHandle implements RuncatIndicatorScheduleHandle {
  constructor(private readonly id: ReturnType<typeof setTimeout>) {}
  cancel(): void {
    clearTimeout(this.id);
  }
}

const REAL_CLOCK: RuncatIndicatorClock = {
  now: REAL_NOW,
  schedule: (delayMs, fn) => new RealScheduleHandle(setTimeout(fn, delayMs)),
};

export interface RuncatIndicatorOptions {
  frames: readonly string[];
  intervalMs: number;
}

/**
 * Smooth a transition over this many wall-clock ms. A full min→max sweep
 * takes ~1s; the ease in-out shape means smaller deltas also feel natural.
 */
export const DEFAULT_TRANSITION_MS = 1000;

/**
 * Cubic ease in-out. Flat at both ends so the cat eases into and out of
 * each interval change with no perceptible snap.
 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface RuncatIndicatorSnapshot {
  frame: string;
  frameIndex: number;
  effectiveIntervalMs: number;
  targetIntervalMs: number;
  transitioning: boolean;
}

export class RuncatIndicatorEngine {
  private readonly clock: RuncatIndicatorClock;
  private readonly sink: RuncatIndicatorSink;
  private readonly transitionMs: number;

  private frames: readonly string[];
  private frameIndex = 0;
  private currentIntervalMs: number;
  private stationaryIntervalMs: number;

  private transitionStartMs: number | undefined;
  private transitionFromIntervalMs: number | undefined;
  private transitionToIntervalMs: number | undefined;

  private running = false;
  private pending: RuncatIndicatorScheduleHandle | undefined;

  constructor(
    sink: RuncatIndicatorSink,
    options: RuncatIndicatorOptions,
    clock: RuncatIndicatorClock = REAL_CLOCK,
    transitionMs: number = DEFAULT_TRANSITION_MS,
  ) {
    this.sink = sink;
    this.clock = clock;
    this.transitionMs = Math.max(1, transitionMs);
    this.frames = options.frames;
    this.currentIntervalMs = options.intervalMs;
    this.stationaryIntervalMs = options.intervalMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // Arm the wake-up FIRST so a throwing sink cannot strand the engine in
    // a half-started state (running but no timer ever fires).
    this.armNext(this.currentIntervalMs);
    this.pushCurrent();
  }

  stop(): void {
    this.running = false;
    this.cancelPending();
  }

  isRunning(): boolean {
    return this.running;
  }

  hasFrames(): boolean {
    return this.frames.length > 0;
  }

  get targetIntervalMs(): number {
    return this.stationaryIntervalMs;
  }

  isTransitioning(): boolean {
    return (
      this.transitionStartMs !== undefined &&
      this.transitionFromIntervalMs !== undefined &&
      this.transitionToIntervalMs !== undefined
    );
  }

  /**
   * Set a new target interval. If the engine is mid-transition, the new
   * ease starts from the *current effective* interval (chase), so repeated
   * retargets never cause a jump.
   *
   * No-op when the new target is identical to what we are already heading
   * toward (or sitting at).
   */
  setTargetInterval(targetMs: number): void {
    if (this.isTransitioning()) {
      if (targetMs === this.transitionToIntervalMs) return;
    } else if (targetMs === this.stationaryIntervalMs) {
      return;
    }

    this.transitionFromIntervalMs = this.peekEffective(this.clock.now());
    this.transitionToIntervalMs = targetMs;
    this.stationaryIntervalMs = targetMs;
    this.transitionStartMs = this.clock.now();
  }

  /**
   * Change the frames shown (e.g. when the user switches spinner presets).
   * Keeps the current frame index continuous when the new list is a cyclic
   * rotation of the old one; otherwise resets to frame 0.
   */
  setFrames(frames: readonly string[]): void {
    if (!isCyclicRotation(this.frames, frames)) this.frameIndex = 0;
    this.frames = frames;
    if (this.running) this.pushCurrent();
  }

  snapshot(): RuncatIndicatorSnapshot {
    const now = this.clock.now();
    return {
      frame: this.frameAt(this.frameIndex),
      frameIndex: this.frameIndex,
      effectiveIntervalMs: this.commitEffective(now),
      targetIntervalMs: this.stationaryIntervalMs,
      transitioning: this.isTransitioning(),
    };
  }

  private frameAt(index: number): string {
    if (this.frames.length === 0) return "";
    return this.frames[index % this.frames.length] ?? "";
  }

  /** Pure peek: no internal state changes. */
  private peekEffective(now: number): number {
    if (!this.isTransitioning()) return this.currentIntervalMs;
    const start = this.transitionStartMs!;
    const from = this.transitionFromIntervalMs!;
    const to = this.transitionToIntervalMs!;
    const elapsed = now - start;
    if (elapsed >= this.transitionMs) return to;
    if (elapsed <= 0) return from;
    const t = elapsed / this.transitionMs;
    return lerp(from, to, easeInOutCubic(t));
  }

  /** Peek + finalize the transition once wall-clock time has elapsed. */
  private commitEffective(now: number): number {
    const value = this.peekEffective(now);
    if (this.isTransitioning() && now - this.transitionStartMs! >= this.transitionMs) {
      this.currentIntervalMs = this.transitionToIntervalMs!;
      this.transitionStartMs = undefined;
      this.transitionFromIntervalMs = undefined;
      this.transitionToIntervalMs = undefined;
    }
    return value;
  }

  private pushCurrent(): void {
    this.sink.pushFrame(this.frameAt(this.frameIndex));
  }

  private armNext(delayMs: number): void {
    if (!this.running) return;
    this.cancelPending();
    this.pending = this.clock.schedule(Math.max(1, delayMs), () => this.onWake());
  }

  private cancelPending(): void {
    if (this.pending !== undefined) {
      this.pending.cancel();
      this.pending = undefined;
    }
  }

  private onWake(): void {
    this.pending = undefined;
    if (!this.running) return;
    const now = this.clock.now();
    this.currentIntervalMs = this.commitEffective(now);
    // Arm the next wake-up before pushing so a throwing sink cannot kill
    // the animation loop.
    this.armNext(this.currentIntervalMs);
    if (this.frames.length > 0) {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
    }
    this.pushCurrent();
  }
}

function isCyclicRotation(current: readonly string[], next: readonly string[]): boolean {
  if (current.length === 0 || next.length === 0) return false;
  if (current.length !== next.length) return false;
  if (current === next) return true;
  const first = current[0]!;
  const starts: number[] = [];
  for (let i = 0; i < next.length; i++) {
    if (next[i] === first) starts.push(i);
  }
  if (starts.length === 0) return false;
  return starts.some((start) => current.every((f, j) => f === next[(start + j) % next.length]));
}
