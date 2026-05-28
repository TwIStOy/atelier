import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Component, TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

export function makeAboveWidget(ctx: ExtensionContext): (tui: TUI, theme: Theme) => Component & { dispose?(): void } {
    return (_tui, theme) => ({
        render(width: number): string[] {
            const usage = ctx.getContextUsage();
            const model = ctx.model;

            const parts: string[] = [];

            if (model) {
                parts.push(theme.fg("muted", model.id));
            }

            if (usage && usage.percent !== null) {
                const pct = Math.round(usage.percent);
                const ctxWin = usage.contextWindow ? `/${(usage.contextWindow / 1000).toFixed(0)}k` : "";
                const color = pct > 80 ? "warning" : pct > 50 ? "muted" : "dim";
                parts.push(theme.fg(color, `ctx ${pct}%${ctxWin}`));
            }

            if (parts.length === 0) return [];
            return [truncateToWidth(parts.join(theme.fg("dim", " · ")), width)];
        },
        invalidate() {},
    });
}
