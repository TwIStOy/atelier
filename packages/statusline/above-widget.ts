import type { Component, TUI } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { ContextUsageComponent } from "./components/context-usage.ts";
import { ModelInfoComponent } from "./components/model-info.ts";
import type { StatusLineComponent } from "./components/base.ts";

export function makeAboveWidget(
    ctx: ExtensionContext,
    pi: ExtensionAPI,
): (tui: TUI, theme: Theme) => Component & { dispose?(): void } {
    const components: StatusLineComponent[] = [
        new ModelInfoComponent(ctx, pi),
        new ContextUsageComponent(ctx),
    ];

    return (_tui, theme) => ({
        render(width: number): string[] {
            const parts: string[] = [];

            for (const comp of components) {
                const lines = comp.render(width, theme);
                if (lines.length > 0) {
                    parts.push(lines[0]);
                }
            }

            if (parts.length === 0) return [];
            return [parts.join(theme.fg("dim", " | "))];
        },
        invalidate() {},
    });
}
