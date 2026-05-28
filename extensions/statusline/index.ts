import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type {
    ExtensionAPI,
    ExtensionContext,
    ReadonlyFooterDataProvider,
    Theme,
} from "@earendil-works/pi-coding-agent";

function formatTokens(n: number): string {
    if (n < 1000) return `${n}`;
    if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
    return `${(n / 1_000_000).toFixed(1)}M`;
}

function formatCwd(cwd: string): string {
    const home = process.env.HOME;
    if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
    return cwd;
}

function getSessionStats(ctx: ExtensionContext) {
    let input = 0;
    let output = 0;
    let cost = 0;
    let turns = 0;
    for (const e of ctx.sessionManager.getBranch()) {
        if (e.type === "message" && e.message.role === "assistant") {
            const m = e.message as AssistantMessage;
            input += m.usage.input;
            output += m.usage.output;
            cost += m.usage.cost.total;
            turns++;
        }
    }
    return { input, output, cost, turns };
}

function makeAboveWidget(ctx: ExtensionContext): (tui: TUI, theme: Theme) => Component & { dispose?(): void } {
    return (_tui, theme) => ({
        render(width: number): string[] {
            const usage = ctx.getContextUsage();
            const model = ctx.model;
            const thinking = "off";

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

function makeBelowWidget(ctx: ExtensionContext): (tui: TUI, theme: Theme) => Component & { dispose?(): void } {
    return (_tui, theme) => ({
        render(width: number): string[] {
            const stats = getSessionStats(ctx);
            if (stats.turns === 0) return [];

            const left = theme.fg(
                "dim",
                `turns ${stats.turns} · ↑${formatTokens(stats.input)} ↓${formatTokens(stats.output)}`,
            );
            const right = theme.fg("dim", `$${stats.cost.toFixed(4)}`);
            const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
            return [truncateToWidth(left + pad + right, width)];
        },
        invalidate() {},
    });
}

function makeFooter(
    ctx: ExtensionContext,
): (tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose?(): void } {
    return (tui, theme, footerData) => {
        const unsub = footerData.onBranchChange(() => tui.requestRender());
        return {
            dispose: unsub,
            invalidate() {},
            render(width: number): string[] {
                const branch = footerData.getGitBranch();
                const model = ctx.model;
                const cwd = formatCwd(ctx.cwd);

                const leftParts: string[] = [];
                if (model) leftParts.push(model.id);
                if (branch) leftParts.push(branch);
                leftParts.push(cwd);
                const left = theme.fg("dim", leftParts.join(" · "));

                const statuses = footerData.getExtensionStatuses();
                const statusTexts = [...statuses.values()];
                const right = statusTexts.length > 0
                    ? theme.fg("muted", statusTexts.join(" "))
                    : theme.fg("dim", "ready");

                const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
                return [truncateToWidth(left + pad + right, width)];
            },
        };
    };
}

export default function (pi: ExtensionAPI) {
    pi.on("session_start", async (_event, ctx) => {
        if (!ctx.hasUI) return;

        ctx.ui.setWidget("statusline-above", makeAboveWidget(ctx), { placement: "aboveEditor" });
        ctx.ui.setWidget("statusline-below", makeBelowWidget(ctx), { placement: "belowEditor" });
        ctx.ui.setFooter(makeFooter(ctx));
    });

    pi.on("session_shutdown", () => {});
}
