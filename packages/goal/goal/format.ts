import {
  formatGoalElapsedSeconds,
  formatTokensCompact,
} from "@htwang-contrib/common";
import type { Goal } from "./types.ts";

export { formatGoalElapsedSeconds, formatTokensCompact };

export function formatGoalForTool(goal: Goal | null): string {
  if (!goal) return "No goal is currently set.";
  const budgetText =
    goal.tokenBudget === undefined
      ? "none"
      : `${formatTokensCompact(goal.tokenBudget)} tokens`;
  return [
    `Goal: ${goal.objective}`,
    `Status: ${goal.status}`,
    `Used: ${formatTokensCompact(goal.tokensUsed)} tokens · ${formatGoalElapsedSeconds(goal.timeUsedSeconds)}`,
    `Budget: ${budgetText}`,
  ].join("\n");
}

export function formatGoalToolResponse(
  goal: Goal | null,
): Record<string, unknown> {
  if (!goal) {
    return {
      goal: null,
      remainingTokens: null,
      completionBudgetReport: "No goal is currently set.",
    };
  }
  const remainingTokens =
    goal.tokenBudget === undefined
      ? null
      : Math.max(0, goal.tokenBudget - goal.tokensUsed);
  return {
    goal,
    remainingTokens,
    completionBudgetReport:
      remainingTokens === null
        ? "No token budget set."
        : `${formatTokensCompact(remainingTokens)} tokens remaining.`,
  };
}
