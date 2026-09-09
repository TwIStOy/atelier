export interface IdleListenerOptions {
  idleMs: number;
  pollMs?: number;
}

type IdleHash = string | number | boolean;

export type IdleState = "active" | "watching" | "idle";

type IdleCallback<T> = (ctx: T) => void;

const DEFAULT_POLL_MS = 1_000;

const MIN_IDLE_MS = 5_000;

/**
 * Detects "user stepped away" by polling a state hash (agent busy + editor text).
 * While watching, any hash change restarts the idle timer, so typing in the editor
 * or agent activity defers the idle trigger. `wake` fires on explicit activity
 * events and resets to active; `enter` fires once when the timer expires.
 */
export class IdleListener<T> {
  private state: IdleState = "active";
  private readonly computeStateHash: (ctx: T) => IdleHash;
  private readonly idleMs: number;
  private readonly pollMs: number;
  private lastStateHash: IdleHash | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private readonly enterCallbacks = new Set<IdleCallback<T>>();
  private readonly wakeCallbacks = new Set<IdleCallback<T>>();

  constructor(computeStateHash: (ctx: T) => IdleHash, options: IdleListenerOptions) {
    this.computeStateHash = computeStateHash;
    this.idleMs = Math.max(options.idleMs, MIN_IDLE_MS);
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  }

  on(event: "enter" | "wake", callback: IdleCallback<T>): () => void {
    const callbacks = event === "enter" ? this.enterCallbacks : this.wakeCallbacks;
    callbacks.add(callback);
    return () => callbacks.delete(callback);
  }

  watch(ctx: T): void {
    if (this.state === "idle") return;

    this.stopTimers();
    this.state = "watching";

    this.lastStateHash = this.computeStateHash(ctx);
    this.resetIdleTimer(ctx);

    this.pollTimer = setInterval(() => {
      const current = this.computeStateHash(ctx);
      if (current === this.lastStateHash) return;

      this.lastStateHash = current;
      this.resetIdleTimer(ctx);
    }, this.pollMs);
  }

  enter(ctx: T): void {
    if (this.state === "idle") return;

    this.stopTimers();
    this.state = "idle";
    for (const callback of this.enterCallbacks) callback(ctx);
  }

  wake(ctx: T): void {
    this.stopTimers();
    this.state = "active";
    for (const callback of this.wakeCallbacks) callback(ctx);
  }

  dispose(): void {
    this.stopTimers();
    this.state = "active";
    this.enterCallbacks.clear();
    this.wakeCallbacks.clear();
  }

  private resetIdleTimer(ctx: T): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      this.enter(ctx);
    }, this.idleMs);
  }

  private stopTimers(): void {
    this.clearIdleTimer();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }
}
