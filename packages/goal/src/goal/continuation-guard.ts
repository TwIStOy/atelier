export interface ContinuationGuard {
  shouldQueue(goalId: string): boolean;
  markQueued(goalId: string): void;
  clear(): void;
  queuedFor(): string | null;
}

export function createContinuationGuard(): ContinuationGuard {
  let queuedFor: string | null = null;

  return {
    shouldQueue(goalId) {
      return queuedFor !== goalId;
    },
    markQueued(goalId) {
      queuedFor = goalId;
    },
    clear() {
      queuedFor = null;
    },
    queuedFor() {
      return queuedFor;
    },
  };
}
