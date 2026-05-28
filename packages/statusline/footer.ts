import type { Component, TUI } from "@earendil-works/pi-tui";
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { CodingPlanUsageComponent } from "./components/coding-plan-usage.ts";
import { ContextUsageComponent } from "./components/context-usage.ts";
import { ModelInfoComponent } from "./components/model-info.ts";
import { PathComponent } from "./components/path.ts";
import { GitComponent } from "./components/git.ts";
import { TokensComponent } from "./components/tokens.ts";
import type { StatusLineComponent } from "./components/base.ts";

export function makeFooter(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
): (
  tui: TUI,
  theme: Theme,
  _footerData: ReadonlyFooterDataProvider,
) => Component & { dispose?(): void } {
  const git = new GitComponent(ctx);
  const codingPlan = new CodingPlanUsageComponent(ctx, pi);

  const components: StatusLineComponent[] = [
    new ModelInfoComponent(ctx, pi),
    new PathComponent(ctx),
    git,
    codingPlan,
    new ContextUsageComponent(ctx),
    new TokensComponent(ctx),
  ];

  return (tui, theme) => {
    git.bindRender(() => tui.requestRender());
    codingPlan.bindRender(() => tui.requestRender());

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
