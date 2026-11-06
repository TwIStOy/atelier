import { formatElapsedSeconds, formatTokens } from "@htwang-contrib/common/format";
import type { Goal } from "./types.ts";

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
  const result = goalResultFields(goal);
  appendBudgetFields(result, goal);
  appendTimestampFields(result, goal);
  return {
    ...result,
    completionBudgetReport: budgetReportLine(goal),
  };
}

function goalResultFields(goal: Goal): Record<string, unknown> {
  return {
    id: goal.id,
    objective: goal.objective,
    status: goal.status,
    tokensUsed: goal.tokensUsed,
    timeUsedSeconds: goal.timeUsedSeconds,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  };
}

function appendBudgetFields(result: Record<string, unknown>, goal: Goal): void {
  if (goal.tokenBudget === null) return;
  result.tokenBudget = goal.tokenBudget;
  result.remainingTokens = Math.max(0, goal.tokenBudget - goal.tokensUsed);
}

function appendTimestampFields(result: Record<string, unknown>, goal: Goal): void {
  if (goal.lastStartedAt) result.lastStartedAt = goal.lastStartedAt;
  if (goal.completedAt) result.completedAt = goal.completedAt;
}

function budgetReportLine(goal: Goal): string {
  if (goal.tokenBudget === null) return "No token budget set";
  const remaining = Math.max(0, goal.tokenBudget - goal.tokensUsed);
  return `Tokens: ${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget)} used (${formatTokens(remaining)} remaining)`;
}
