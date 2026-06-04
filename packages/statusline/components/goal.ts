import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { formatTokens, formatElapsedSeconds } from "@htwang-contrib/common";
import type { StatusLineComponent } from "./base.ts";

type GoalStatus = "active" | "paused" | "budgetLimited" | "complete";

type GoalLike = {
  status: GoalStatus;
  timeUsedSeconds: number;
  tokensUsed: number;
  tokenBudget: number | null;
};

export class GoalComponent implements StatusLineComponent {
  private goal: GoalLike | null = null;
  private requestRender: (() => void) | null = null;
  private unsub: (() => void) | null = null;

  constructor(private pi: ExtensionAPI) {}

  bindRender(fn: () => void) {
    this.requestRender = fn;
    this.unsub = this.pi.events.on("goal:update", (data: unknown) => {
      this.goal = data as GoalLike | null;
      this.requestRender?.();
    });
  }

  dispose() {
    this.unsub?.();
  }

  render(_width: number, theme: Theme): string[] {
    if (!this.goal) return [];

    switch (this.goal.status) {
      case "active":
        return [
          theme.fg(
            "accent",
            `◉ goal ${formatElapsedSeconds(this.goal.timeUsedSeconds)}`,
          ),
        ];
      case "paused":
        return [theme.fg("muted", "◎ goal paused")];
      case "budgetLimited":
        return [
          theme.fg(
            "warning",
            `goal unmet ${formatTokens(this.goal.tokensUsed)}/${formatTokens(this.goal.tokenBudget ?? 0)}`,
          ),
        ];
      case "complete":
        return [
          theme.fg(
            "success",
            `✓ goal done ${formatElapsedSeconds(this.goal.timeUsedSeconds)}`,
          ),
        ];
      default:
        return [];
    }
  }
}
