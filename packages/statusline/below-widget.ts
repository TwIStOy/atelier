import type { Component, TUI } from "@earendil-works/pi-tui";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { CodingPlanUsageComponent } from "./components/coding-plan-usage.ts";
import { ModelInfoComponent } from "./components/model-info.ts";
import { GitComponent } from "./components/git.ts";
import type { StatusLineComponent } from "./components/base.ts";

export function makeBelowWidget(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
): (tui: TUI, theme: Theme) => Component & { dispose?(): void } {
  const git = new GitComponent(ctx);
  const codingPlan = new CodingPlanUsageComponent(ctx, pi);

  const components: StatusLineComponent[] = [
    new ModelInfoComponent(ctx, pi),
    git,
    codingPlan,
  ];

  return (_tui, theme) => {
    git.bindRender(() => _tui.requestRender());
    codingPlan.bindRender(() => _tui.requestRender());

    return {
      dispose() {
        git.dispose();
        codingPlan.dispose();
      },
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
    };
  };
}
