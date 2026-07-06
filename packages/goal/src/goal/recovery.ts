export interface RecoveryState {
  consecutiveErrors: number;
  lastErrorMessage: string | null;
}

export function createRecoveryState(): RecoveryState {
  return { consecutiveErrors: 0, lastErrorMessage: null };
}

export function resetRecovery(state: RecoveryState): void {
  state.consecutiveErrors = 0;
  state.lastErrorMessage = null;
}

export function noteRecoveryError(state: RecoveryState, message: string): void {
  state.consecutiveErrors += 1;
  state.lastErrorMessage = message;
}
