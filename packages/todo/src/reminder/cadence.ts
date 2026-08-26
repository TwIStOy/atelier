export interface ReminderCadenceState {
  currentTurn: number;
  lastTodoToolUseTurn: number;
  reminderDue: boolean;
}

export function createReminderCadence(): ReminderCadenceState {
  return {
    currentTurn: 0,
    lastTodoToolUseTurn: 0,
    reminderDue: false,
  };
}

export function resetReminderCadence(state: ReminderCadenceState): void {
  state.currentTurn = 0;
  state.lastTodoToolUseTurn = 0;
  state.reminderDue = false;
}

export function onTurnStart(state: ReminderCadenceState): void {
  state.currentTurn++;
}

export function evaluateToolResult(
  state: ReminderCadenceState,
  isTodoTool: boolean,
  hasVisibleTasks: boolean,
  interval: number,
): void {
  if (isTodoTool) {
    state.lastTodoToolUseTurn = state.currentTurn;
    state.reminderDue = false;
    return;
  }
  if (state.reminderDue) return;
  if (state.currentTurn - state.lastTodoToolUseTurn < interval) return;
  if (!hasVisibleTasks) return;
  state.reminderDue = true;
}

export function drainReminderForContext(state: ReminderCadenceState): boolean {
  if (!state.reminderDue) return false;
  state.reminderDue = false;
  state.lastTodoToolUseTurn = state.currentTurn;
  return true;
}
