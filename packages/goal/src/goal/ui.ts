import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { formatElapsedSeconds, formatTokens } from "@htwang-contrib/common";
import type { Goal } from "./types.ts";

export const GOAL_WIDGET_KEY = "pi-extensions.goal";

export const GOAL_WIDGET_OPTIONS = { placement: "aboveEditor" as const };

const TICK_INTERVAL_MS = 1000;

export function displayedElapsedSeconds(goal: Goal, now: number = Date.now()): number {
  if (goal.status === "active" && goal.lastStartedAt !== null) {
    const startedAt = Date.parse(goal.lastStartedAt);
    const liveSeconds = Number.isNaN(startedAt) ? 0 : Math.max(0, (now - startedAt) / 1000);
    return goal.timeUsedSeconds + liveSeconds;
  }
  return goal.timeUsedSeconds;
}

export function renderGoalWidget(goal: Goal | null, theme: Theme, width: number, now: number = Date.now()): string[] {
  if (!goal) return [];

  let statusText: string;
  switch (goal.status) {
    case "active":
      statusText = theme.fg("accent", `◉ ${formatElapsedSeconds(displayedElapsedSeconds(goal, now))}`);
      break;
    case "paused":
      statusText = theme.fg("muted", "◎ paused");
      break;
    case "budgetLimited":
      statusText = theme.fg("warning", `unmet ${formatTokens(goal.tokensUsed)}/${formatTokens(goal.tokenBudget ?? 0)}`);
      break;
    case "complete":
      statusText = theme.fg("success", `✓ ${formatElapsedSeconds(displayedElapsedSeconds(goal, now))}`);
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

export function makeGoalWidget(
  getGoal: () => Goal | null,
): (tui: TUI, theme: Theme) => Component & { dispose?(): void } {
  return (tui: TUI, theme: Theme) => {
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = (): void => {
      if (disposed) return;
      const goal = getGoal();
      if (!goal || goal.status !== "active") return;
      tui.requestRender();
    };

    timer = setInterval(tick, TICK_INTERVAL_MS);

    return {
      render(width: number): string[] {
        const goal = getGoal();
        if (!goal) return [];
        return renderGoalWidget(goal, theme, width);
      },
      invalidate() {},
      dispose() {
        disposed = true;
        if (timer) clearInterval(timer);
        timer = null;
      },
    };
  };
}
