import type { Goal } from "./types.ts";

export function shouldQueueGoalContinuationAfterAgentEnd(
  goal: Goal | null,
  hasPendingMessages: boolean,
): goal is Goal {
  if (!goal) return false;
  if (hasPendingMessages) return false;
  return goal.status === "active";
}

export function shouldQueueBudgetLimitedPrompt(
  goal: Goal | null,
): goal is Goal {
  if (!goal) return false;
  return goal.status === "budgetLimited";
}
