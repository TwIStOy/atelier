import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { formatTokens, formatElapsedSeconds } from "@htwang-contrib/common";
import type { Goal } from "./types.ts";

export const GOAL_WIDGET_KEY = "pi-extensions.goal";

export const GOAL_WIDGET_OPTIONS = { placement: "aboveEditor" as const };

export function renderGoalWidget(
  goal: Goal | null,
  theme: Theme,
  width: number,
): string[] {
  if (!goal) return [];

  let statusText: string;
  switch (goal.status) {
    case "active":
      statusText = theme.fg(
        "accent",
        `◉ ${formatElapsedSeconds(goal.timeUsedSeconds)}`,
      );
      break;
    case "paused":
      statusText = theme.fg("muted", "◎ paused");
      break;
    case "budgetLimited":
      statusText = theme.fg(
        "warning",
        `unmet ${formatTokens(goal.tokensUsed)}/${formatTokens(goal.tokenBudget ?? 0)}`,
      );
      break;
    case "complete":
      statusText = theme.fg(
        "success",
        `✓ ${formatElapsedSeconds(goal.timeUsedSeconds)}`,
      );
      break;
    default:
      return [];
  }

  const label = theme.fg("dim", "goal");
  const sep = theme.fg("dim", " ");
  const objective = truncateObjective(goal.objective, 80, theme);

  const left = `${label}${sep}${statusText}${sep}${objective}`;
  return [left];
}

function truncateObjective(text: string, maxLen: number, theme: Theme): string {
  if (text.length <= maxLen) return theme.fg("dim", text);
  return theme.fg("dim", text.slice(0, maxLen - 1) + "…");
}
