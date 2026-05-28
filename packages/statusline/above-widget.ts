import type { Component, TUI } from "@earendil-works/pi-tui";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { ContextUsageComponent } from "./components/context-usage.ts";
import { PathComponent } from "./components/path.ts";
import { TokensComponent } from "./components/tokens.ts";
import type { StatusLineComponent } from "./components/base.ts";

export function makeAboveWidget(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
): (tui: TUI, theme: Theme) => Component & { dispose?(): void } {
  const components: StatusLineComponent[] = [
    new PathComponent(ctx),
    new ContextUsageComponent(ctx),
    new TokensComponent(ctx),
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
