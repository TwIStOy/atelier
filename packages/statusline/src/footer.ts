import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { fitSegmentsByPriority, type PrioritizedSegment } from "@htwang-contrib/common";
import type { StatusLineComponent } from "./components/base.ts";
import { CodingPlanUsageComponent } from "./components/coding-plan-usage.ts";
import { ExtensionStatusComponent } from "./components/extension-status.ts";
import { GitComponent } from "./components/git.ts";
import { TokensComponent } from "./components/tokens.ts";
import { loadConfig } from "./config.ts";

export function makeFooter(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
): (tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose?(): void } {
  const config = loadConfig();

  const git = config.showGitBranch ? new GitComponent(ctx.cwd) : null;
  const codingPlan = new CodingPlanUsageComponent(ctx, pi);
  const tokens = new TokensComponent(ctx);

  const segments: { component: StatusLineComponent; priority: number }[] = [];
  if (git) segments.push({ component: git, priority: 1 });
  segments.push({ component: codingPlan, priority: 2 });
  segments.push({ component: tokens, priority: 3 });

  return (tui, theme, footerData) => {
    git?.bindRender(() => tui.requestRender());
    codingPlan.bindRender(() => tui.requestRender());

    const extensionStatus = config.showExtensionStatus ? new ExtensionStatusComponent(footerData) : null;

    return {
      dispose() {
        git?.dispose();
        codingPlan.dispose();
      },
      render(width: number): string[] {
        const fitted: PrioritizedSegment[] = [];
        if (extensionStatus) {
          const text = extensionStatus.render(width, theme)[0];
          if (text) fitted.push({ text, priority: 0 });
        }
        for (const { component, priority } of segments) {
          const lines = component.render(width, theme);
          const text = lines[0];
          if (!text) continue;
          fitted.push({ text, priority });
        }
        if (fitted.length === 0) return [];
        const separator = theme.fg("dim", " | ");
        const line = fitSegmentsByPriority(fitted, width, {
          separator,
          measure: visibleWidth,
          truncate: (text, maxWidth) => truncateToWidth(text, maxWidth, ""),
        });
        return [line];
      },
      invalidate() {},
    };
  };
}
