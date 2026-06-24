import { formatElapsedSeconds, formatTokens } from "@htwang-contrib/common";
import type { Goal, TokenUsageSnapshot } from "./types.ts";

export function formatGoalForTool(goal: Goal): string {
  const lines: string[] = [
    `ID: ${goal.id}`,
    `Objective: ${goal.objective}`,
    `Status: ${goal.status}`,
    `Tokens used: ${formatTokens(goal.tokensUsed)}${goal.tokenBudget ? ` / ${formatTokens(goal.tokenBudget)}` : ""}`,
    `Time used: ${formatElapsedSeconds(goal.timeUsedSeconds)}`,
    `Created: ${goal.createdAt}`,
    `Updated: ${goal.updatedAt}`,
  ];
  if (goal.lastStartedAt) {
    lines.push(`Last started: ${goal.lastStartedAt}`);
  }
  if (goal.completedAt) {
    lines.push(`Completed: ${goal.completedAt}`);
  }
  return lines.join("\n");
}

export function formatGoalToolResponse(goal: Goal): Record<string, unknown> {
  const remainingTokens = goal.tokenBudget ? Math.max(0, goal.tokenBudget - goal.tokensUsed) : null;
  const result: Record<string, unknown> = {
    id: goal.id,
    objective: goal.objective,
    status: goal.status,
    tokensUsed: goal.tokensUsed,
    timeUsedSeconds: goal.timeUsedSeconds,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  };
  if (goal.tokenBudget !== null) {
    result.tokenBudget = goal.tokenBudget;
    result.remainingTokens = remainingTokens;
  }
  if (goal.lastStartedAt) result.lastStartedAt = goal.lastStartedAt;
  if (goal.completedAt) result.completedAt = goal.completedAt;

  const budgetReport =
    goal.tokenBudget !== null
      ? `Tokens: ${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget)} used (${formatTokens(remainingTokens!)} remaining)`
      : undefined;

  return {
    ...result,
    completionBudgetReport: budgetReport ?? "No token budget set",
  };
}

export function formatTokenUsageSnapshot(snapshot: TokenUsageSnapshot): string {
  const parts = [
    `in=${formatTokens(snapshot.input)}`,
    `out=${formatTokens(snapshot.output)}`,
    `cacheRead=${formatTokens(snapshot.cacheRead)}`,
    `cacheWrite=${formatTokens(snapshot.cacheWrite)}`,
  ];
  return `TokenUsage(${parts.join(", ")} total=${formatTokens(snapshot.totalTokens)})`;
}
