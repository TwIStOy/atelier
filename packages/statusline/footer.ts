import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import { formatCwd } from "./utils.ts";

export function makeFooter(
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
