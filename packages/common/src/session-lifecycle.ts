/**
 * Generation counter that fences stale async callbacks out of the current
 * session.
 *
 * Capture a generation before an `await`, then re-check it after: if the
 * session has moved on (started again or shut down), the callback is stale and
 * must not mutate live state or trigger renders.
 *
 * ```ts
 * const gen = lifecycle.currentGeneration();
 * const result = await slowFetch();
 * if (!lifecycle.isCurrent(gen)) return; // a newer session superseded us
 * ```
 */
export class SessionLifecycle {
  private generation = 0;
  private shutDown = false;

  /** Advance to a new generation. Clears any prior shutdown. */
  start(): void {
    this.generation += 1;
    this.shutDown = false;
  }

  /** Mark the lifecycle as shut down; all `isCurrent` checks thereafter fail. */
  shutdown(): void {
    this.shutDown = true;
  }

  /**
   * True when `generation` matches the current generation and the lifecycle has
   * not shut down. `undefined` matches any non-shut-down generation (use for
   * synchronous, pre-`await` checks).
   */
  isCurrent(generation?: number): boolean {
    if (this.shutDown) return false;
    if (generation === undefined) return true;
    return generation === this.generation;
  }

  /** The current generation counter, to capture before an async boundary. */
  currentGeneration(): number {
    return this.generation;
  }
}
