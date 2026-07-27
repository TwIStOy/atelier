import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { fitSegmentsByPriority, type PrioritizedSegment, SessionLifecycle } from "@htwang-contrib/common";
import type { StatusLineComponent } from "./components/base.ts";
import { CodingPlanUsageComponent } from "./components/coding-plan-usage.ts";
import { GitComponent } from "./components/git.ts";
import { RuntimeComponent } from "./components/runtime.ts";
import { TokensComponent } from "./components/tokens.ts";
import { loadConfig } from "./config.ts";

export function makeFooter(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
): (tui: TUI, theme: Theme, _footerData: ReadonlyFooterDataProvider) => Component & { dispose?(): void } {
  const config = loadConfig();
  const lifecycle = new SessionLifecycle();
  lifecycle.start();

  const git = config.showGitBranch ? new GitComponent(ctx.cwd) : null;
  const runtime = config.showRuntime ? new RuntimeComponent(ctx.cwd, lifecycle) : null;
  const codingPlan = new CodingPlanUsageComponent(ctx, pi);
  const tokens = new TokensComponent(ctx);

  const segments: { component: StatusLineComponent; priority: number }[] = [];
  if (git) segments.push({ component: git, priority: 1 });
  if (runtime) segments.push({ component: runtime, priority: 1 });
  segments.push({ component: codingPlan, priority: 2 });
  segments.push({ component: tokens, priority: 3 });

  return (tui, theme) => {
    git?.bindRender(() => tui.requestRender());
    runtime?.bindRender(() => tui.requestRender());
    codingPlan.bindRender(() => tui.requestRender());

    return {
      dispose() {
        git?.dispose();
        runtime?.dispose();
        codingPlan.dispose();
        lifecycle.shutdown();
      },
      render(width: number): string[] {
        const fitted: PrioritizedSegment[] = [];
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
