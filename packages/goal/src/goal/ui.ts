import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { formatElapsedSeconds, formatTokens } from "@htwang-contrib/common";
import type { Goal } from "./types.ts";

export const GOAL_WIDGET_KEY = "pi-extensions.goal";

export const GOAL_WIDGET_OPTIONS = { placement: "aboveEditor" as const };

export function renderGoalWidget(goal: Goal | null, theme: Theme, width: number): string[] {
  if (!goal) return [];

  let statusText: string;
  switch (goal.status) {
    case "active":
      statusText = theme.fg("accent", `◉ ${formatElapsedSeconds(goal.timeUsedSeconds)}`);
      break;
    case "paused":
      statusText = theme.fg("muted", "◎ paused");
      break;
    case "budgetLimited":
      statusText = theme.fg("warning", `unmet ${formatTokens(goal.tokensUsed)}/${formatTokens(goal.tokenBudget ?? 0)}`);
      break;
    case "complete":
      statusText = theme.fg("success", `✓ ${formatElapsedSeconds(goal.timeUsedSeconds)}`);
      break;
    default:
      return [];
  }

  const label = theme.fg("dim", "goal");
  const sep = theme.fg("dim", " ");
  const prefix = `${label}${sep}${statusText}${sep}`;
  const prefixWidth = visibleWidth(prefix);
  const objective = theme.fg("dim", goal.objective);
  const available = Math.max(0, width - prefixWidth);
  const wrappedLines = wrapTextWithAnsi(objective, available);

  if (wrappedLines.length === 0) return [prefix];

  const indent = " ".repeat(prefixWidth);
  return [`${prefix}${wrappedLines[0]}`, ...wrappedLines.slice(1).map((line) => `${indent}${line}`)];
}
