import type { Component, TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { ContextUsageComponent } from "./components/context-usage.ts";
import type { StatusLineComponent } from "./components/base.ts";

const contextUsage = (ctx: ExtensionContext): StatusLineComponent =>
  new ContextUsageComponent(ctx);

export function makeAboveWidget(
  ctx: ExtensionContext,
): (tui: TUI, theme: Theme) => Component & { dispose?(): void } {
  const components = [contextUsage(ctx)];

  return (_tui, theme) => ({
    render(width: number): string[] {
      const model = ctx.model;

      const parts: string[] = [];

      if (model) {
        parts.push(theme.fg("muted", model.id));
      }

      for (const comp of components) {
        const compLines = comp.render(width, theme);
        if (compLines.length > 0) {
          parts.push(compLines[0]);
        }
      }

      if (parts.length === 0) return [];
      return [parts.join(theme.fg("dim", " | "))];
    },
    invalidate() {},
  });
}
