import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { loadSubagentRuns, type SubagentRunSummary } from "./index.ts";
import { type SubagentViewerAction, SubagentViewerOverlay, subagentViewerOverlayOptions } from "./overlay.ts";

export const VIEWER_DEFAULTS = {
  expanded: false,
  hideThinkingBlock: false,
} as const;

function pickIndex(picked: string | undefined, labels: string[]): number | null {
  if (picked === undefined) return null;
  if (picked === "← Close") return -1;
  const i = labels.indexOf(picked);
  return i >= 0 ? i : null;
}

function buildLabels(runs: SubagentRunSummary[]): string[] {
  const labels: string[] = [];
  for (const run of runs) {
    const head = run.label || "(untitled)";
    const prefix = run.running ? "⏳ " : "";
    const model = run.model ? ` · ${run.model}` : "";
    const tools = run.running ? " · running…" : ` · ${run.toolCalls} tool call${run.toolCalls === 1 ? "" : "s"}`;
    labels.push(`${prefix}${head}${model}${tools}`);
  }
  labels.push("← Close");
  return labels;
}

function showViewer(
  ctx: ExtensionCommandContext,
  parentSessionId: string,
  runs: SubagentRunSummary[],
  initialIndex: number,
): Promise<SubagentViewerAction> {
  return ctx.ui.custom<SubagentViewerAction>(
    (tui: TUI, theme: Theme, _keybindings, done) => {
      const overlay = new SubagentViewerOverlay({
        tui,
        theme,
        runs,
        initialIndex,
        parentSessionId,
        renderOptions: {
          expanded: VIEWER_DEFAULTS.expanded,
          hideThinkingBlock: VIEWER_DEFAULTS.hideThinkingBlock,
        },
        onAction: (action) => {
          done(action);
        },
      });
      return overlay as Component;
    },
    {
      overlay: true,
      overlayOptions: subagentViewerOverlayOptions(),
    },
  );
}

export async function runSubagentViewerCommand(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("subagents viewer requires the Pi TUI.", "warning");
    return;
  }

  const parentSessionId = ctx.sessionManager.getHeader()?.id ?? "";
  if (!parentSessionId) {
    ctx.ui.notify("subagents viewer: no active session to list subagents for.", "warning");
    return;
  }

  let runs = loadSubagentRuns(parentSessionId);
  if (runs.length === 0) {
    ctx.ui.notify("No subagent runs recorded for this session.", "info");
    return;
  }

  while (true) {
    runs = loadSubagentRuns(parentSessionId);
    if (runs.length === 0) {
      ctx.ui.notify("No subagent runs recorded for this session.", "info");
      return;
    }

    const labels = buildLabels(runs);
    const picked = await ctx.ui.select("Subagents — choose a run to view", labels);
    const idx = pickIndex(picked, labels);
    if (idx === null || idx === -1) return;

    const action = await showViewer(ctx, parentSessionId, runs, idx);
    if (action === "picker") continue;
    return;
  }
}
