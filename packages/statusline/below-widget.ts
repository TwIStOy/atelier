import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { formatTokens, getSessionStats } from "./utils.ts";

export function makeBelowWidget(
  ctx: ExtensionContext,
): (tui: TUI, theme: Theme) => Component & { dispose?(): void } {
  return (_tui, theme) => ({
    render(width: number): string[] {
      const stats = getSessionStats(ctx);
      if (stats.turns === 0) return [];

      const left = theme.fg(
        "dim",
        `turns ${stats.turns} · ↑${formatTokens(stats.input)} ↓${formatTokens(stats.output)}`,
      );
      const right = theme.fg("dim", `$${stats.cost.toFixed(4)}`);
      const pad = " ".repeat(
        Math.max(1, width - visibleWidth(left) - visibleWidth(right)),
      );
      return [truncateToWidth(left + pad + right, width)];
    },
    invalidate() {},
  });
}
