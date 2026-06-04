import { formatTokens, formatElapsedSeconds } from "@htwang-contrib/common";
import type { Goal } from "./types.ts";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function budgetSection(goal: Goal): string {
  if (goal.tokenBudget === null) {
    return `Tokens used: ${formatTokens(goal.tokensUsed)}
Time used: ${formatElapsedSeconds(goal.timeUsedSeconds)}`;
  }

  const remaining = Math.max(0, goal.tokenBudget - goal.tokensUsed);
  return `Token budget: ${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget)} used (${formatTokens(remaining)} remaining)
Time used: ${formatElapsedSeconds(goal.timeUsedSeconds)}`;
}

export function buildContinuationPrompt(goal: Goal): string {
  const lines: string[] = [
    "You are continuing pursuit of an active goal. Do NOT repeat work already done — review the conversation history and continue from where you left off.",
    "",
    "<untrusted_objective>",
    escapeXml(goal.objective),
    "</untrusted_objective>",
    "",
    budgetSection(goal),
    "",
    "Before marking this goal complete with update_goal, you MUST verify ALL of the following:",
    "1. The objective has been fully addressed — every part of the goal is satisfied.",
    "2. All code changes compile without errors and pass existing tests.",
    "3. No remaining edge cases, unhandled errors, or TODOs related to the objective.",
    "4. You have run relevant tests or validation commands to confirm correctness.",
    "",
    "Do NOT mark complete if any work remains. If you are unsure, continue working or use tools to verify.",
    "",
    'If the goal is truly complete, call update_goal with status "complete". Otherwise, keep working.',
  ];

  return lines.join("\n");
}

export function buildBudgetLimitedPrompt(goal: Goal): string {
  const remaining = Math.max(0, (goal.tokenBudget ?? 0) - goal.tokensUsed);
  const lines: string[] = [
    "The active goal has exceeded its token budget and is now marked as budget_limited.",
    "",
    "<untrusted_objective>",
    escapeXml(goal.objective),
    "</untrusted_objective>",
    "",
    `Tokens used: ${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget!)} (over by ${formatTokens(goal.tokensUsed - goal.tokenBudget!)})`,
    `Time used: ${formatElapsedSeconds(goal.timeUsedSeconds)}`,
    "",
    "Please summarize what has been accomplished so far and list any remaining work. Do NOT mark the goal as complete unless the objective is fully satisfied.",
    "",
    "If the user wants to continue, they can increase the budget or clear and re-create the goal.",
  ];

  return lines.join("\n");
}
