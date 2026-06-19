export interface EstimatedFrame {
  index: number;
  frame: string;
}

export interface FrameEstimatorNow {
  now(): number;
}

const defaultNow: FrameEstimatorNow = {
  now: () => Date.now(),
};

export class FrameEstimator {
  private frames: readonly string[] | undefined;
  private intervalMs: number | undefined;
  private baseMs: number | undefined;
  private readonly now: FrameEstimatorNow;

  constructor(now: FrameEstimatorNow = defaultNow) {
    this.now = now;
  }

  reset(frames: readonly string[], intervalMs: number): void {
    this.frames = frames;
    this.intervalMs = intervalMs;
    this.baseMs = this.now.now();
  }

  clear(): void {
    this.frames = undefined;
    this.intervalMs = undefined;
    this.baseMs = undefined;
  }

  isKnown(): boolean {
    return (
      this.frames !== undefined &&
      this.intervalMs !== undefined &&
      this.baseMs !== undefined
    );
  }

  isCyclicRotation(other: readonly string[]): boolean {
    const frames = this.frames;
    if (!frames || frames.length === 0) return false;
    if (frames.length !== other.length) return false;
    if (frames === other) return true;
    const first = frames[0]!;
    const starts: number[] = [];
    for (let i = 0; i < other.length; i++) {
      if (other[i] === first) starts.push(i);
    }
    if (starts.length === 0) return false;
    return starts.some((start) =>
      frames!.every((f, j) => f === other[(start + j) % other.length]),
    );
  }

  rotatedForReset(
    nextFrames: readonly string[],
    nextIntervalMs: number,
  ): string[] {
    const out = [...nextFrames];
    const current = this.estimate();
    if (
      !current ||
      nextFrames.length === 0 ||
      nextIntervalMs <= 0 ||
      !this.isCyclicRotation(nextFrames)
    ) {
      return out;
    }
    const rot = current.index % nextFrames.length;
    if (rot === 0) return out;
    return [...out.slice(rot), ...out.slice(0, rot)];
  }

  estimate(now: number = this.now.now()): EstimatedFrame | null {
    const frames = this.frames;
    const intervalMs = this.intervalMs;
    const baseMs = this.baseMs;
    if (!frames || intervalMs === undefined || baseMs === undefined)
      return null;
    if (frames.length === 0) return null;
    if (intervalMs <= 0) {
      return { index: 0, frame: frames[0]! };
    }
    const elapsed = Math.max(0, now - baseMs);
    const index = Math.floor(elapsed / intervalMs) % frames.length;
    return { index, frame: frames[index]! };
  }
}
