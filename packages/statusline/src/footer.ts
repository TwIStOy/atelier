import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { StatusLineComponent } from "./components/base.ts";
import { CodingPlanUsageComponent } from "./components/coding-plan-usage.ts";
import { GitComponent } from "./components/git.ts";
import { TokensComponent } from "./components/tokens.ts";
import { loadConfig } from "./config.ts";

export function makeFooter(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
): (tui: TUI, theme: Theme, _footerData: ReadonlyFooterDataProvider) => Component & { dispose?(): void } {
  const showGit = loadConfig().showGitBranch;
  const git = showGit ? new GitComponent(ctx.cwd) : null;
  const codingPlan = new CodingPlanUsageComponent(ctx, pi);

  const components: StatusLineComponent[] = [...(git ? [git] : []), codingPlan, new TokensComponent(ctx)];

  return (tui, theme) => {
    git?.bindRender(() => tui.requestRender());
    codingPlan.bindRender(() => tui.requestRender());

    return {
      dispose() {
        git?.dispose();
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
        const line = parts.join(theme.fg("dim", " | "));
        return [truncateToWidth(line, width, "")];
      },
      invalidate() {},
    };
  };
}
