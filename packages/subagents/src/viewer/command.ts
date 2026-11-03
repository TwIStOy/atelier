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

function runToolsLabel(run: SubagentRunSummary): string {
  return run.running ? " · running…" : ` · ${run.toolCalls} tool call${run.toolCalls === 1 ? "" : "s"}`;
}

function runLabel(run: SubagentRunSummary): string {
  const head = run.label || "(untitled)";
  const prefix = run.running ? "⏳ " : "";
  const model = run.model ? ` · ${run.model}` : "";
  return `${prefix}${head}${model}${runToolsLabel(run)}`;
}

function buildLabels(runs: SubagentRunSummary[]): string[] {
  const labels = runs.map(runLabel);
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

function viewerSessionId(ctx: ExtensionCommandContext): string | null {
  const id = ctx.sessionManager.getHeader()?.id ?? "";
  if (id) return id;
  ctx.ui.notify("subagents viewer: no active session to list subagents for.", "warning");
  return null;
}

async function viewOneRun(ctx: ExtensionCommandContext, parentSessionId: string): Promise<boolean> {
  const runs = loadSubagentRuns(parentSessionId);
  if (runs.length === 0) {
    ctx.ui.notify("No subagent runs recorded for this session.", "info");
    return false;
  }
  const labels = buildLabels(runs);
  const picked = await ctx.ui.select("Subagents — choose a run to view", labels);
  const idx = pickIndex(picked, labels);
  if (idx === null || idx === -1) return false;
  const action = await showViewer(ctx, parentSessionId, runs, idx);
  return action === "picker";
}

export async function runSubagentViewerCommand(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("subagents viewer requires the Pi TUI.", "warning");
    return;
  }

  const parentSessionId = viewerSessionId(ctx);
  if (parentSessionId === null) return;

  while (await viewOneRun(ctx, parentSessionId)) {
    // keep picking runs until the viewer is dismissed or the picker is closed
  }
}
