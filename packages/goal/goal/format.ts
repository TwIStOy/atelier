import type { Goal } from "./types.ts";

export function formatGoalElapsedSeconds(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return `${safe}s`;
  if (safe < 3600) return `${Math.floor(safe / 60)}m`;
  if (safe < 86400) {
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(safe / 86400);
  const h = Math.floor((safe % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

export function formatTokensCompact(tokens: number): string {
  const safe = Math.max(0, Math.floor(tokens));
  if (safe < 1000) return `${safe}`;
  if (safe < 1_000_000) return `${(safe / 1000).toFixed(1)}K`;
  if (safe < 1_000_000_000) return `${(safe / 1_000_000).toFixed(1)}M`;
  return `${(safe / 1_000_000_000).toFixed(1)}B`;
}

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
