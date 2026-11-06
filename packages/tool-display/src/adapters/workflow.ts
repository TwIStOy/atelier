import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateDisplay } from "@htwang-contrib/common/format";
import { parseWorkflowScript } from "@htwang-contrib/workflow/script";
import { spinnerGlyph } from "../format.ts";
import { defaultCollapsedRenderer } from "../tool-call-display.ts";
import type { ToolDisplayAdapter } from "../types.ts";
import { batchHeader, formatExpandedToolOutputLines, renderContentWithLineNumbers } from "./shared.ts";

interface WorkflowArgs {
  script?: string;
  args?: unknown;
}

type WorkflowAgentRow = {
  id?: number;
  label?: string;
  status?: string;
  toolCalls?: number;
  detail?: string;
};

type WorkflowSnapshot = {
  status?: string;
  agents?: WorkflowAgentRow[];
};

type WorkflowDetails = {
  ok?: boolean;
  error?: string;
  workflow?: WorkflowSnapshot;
};

const TITLE = "Workflow";
const LABEL_MAX = 40;

function workflowName(args: WorkflowArgs): string {
  const raw = typeof args.script === "string" ? args.script : "";
  if (!raw.trim()) return "…";
  const parsed = parseWorkflowScript(raw);
  if (parsed.ok) return parsed.script.meta.name;
  const first = raw.trim().split("\n")[0] ?? "";
  return truncateDisplay(first.replace(/^\/\/\s*/, ""), LABEL_MAX);
}

function asDetails(details: unknown): WorkflowDetails | undefined {
  if (!details || typeof details !== "object") return undefined;
  return details as WorkflowDetails;
}

function agentGlyph(theme: Theme, status: string | undefined, isPartial: boolean, spinAt: number): string {
  switch (status) {
    case "done":
      return theme.fg("success", "✓");
    case "error":
      return theme.fg("error", "✗");
    case "aborted":
      return theme.fg("muted", "–");
    case "running":
      return isPartial ? spinnerGlyph(theme, spinAt) : theme.fg("accent", "●");
    default:
      return theme.fg("muted", "◌");
  }
}

function formatAgentRow(theme: Theme, agent: WorkflowAgentRow, isPartial: boolean, spinAt: number): string {
  const parts: string[] = [];
  parts.push(theme.fg("toolOutput", `#${agent.id ?? "?"} ${truncateDisplay(agent.label ?? "agent", LABEL_MAX)}`));
  if (typeof agent.toolCalls === "number" && agent.toolCalls > 0) {
    const unit = agent.toolCalls === 1 ? "tool" : "tools";
    parts.push(
      theme.fg("muted", "calls ") + theme.fg("toolOutput", String(agent.toolCalls)) + theme.fg("muted", ` ${unit}`),
    );
  }
  const row = `${agentGlyph(theme, agent.status, isPartial, spinAt)} ${parts.join(theme.fg("muted", " · "))}`;
  const detail =
    agent.status === "error" && agent.detail?.trim()
      ? theme.fg("error", ` — ${truncateDisplay(agent.detail.trim(), 120)}`)
      : "";
  return row + detail;
}

function agentRows(details: WorkflowDetails | undefined, theme: Theme, isPartial: boolean, spinAt: number): string[] {
  const agents = details?.workflow?.agents;
  if (!Array.isArray(agents) || agents.length === 0) return [];
  return agents.map((agent) => formatAgentRow(theme, agent, isPartial, spinAt));
}

function settledCounts(details: WorkflowDetails | undefined): { settled: number; total: number } | undefined {
  const agents = details?.workflow?.agents;
  if (!Array.isArray(agents) || agents.length === 0) return undefined;
  const settled = agents.filter((a) => a.status === "done" || a.status === "error" || a.status === "aborted").length;
  return { settled, total: agents.length };
}

export const workflowAdapter: ToolDisplayAdapter<WorkflowArgs> = {
  formatCallHeader(args, theme, details, _isPartial, _expanded, width) {
    return batchHeader(theme, TITLE, workflowName(args), settledCounts(asDetails(details)), "agents", width);
  },

  formatCollapsedContent(_args, output, theme, width, details, isPartial, spinAt = Date.now()) {
    if (isPartial) {
      return agentRows(asDetails(details), theme, true, spinAt);
    }
    if ((output ?? "").trim()) {
      return defaultCollapsedRenderer(output ?? "", theme, width);
    }
    return agentRows(asDetails(details), theme, false, spinAt);
  },

  formatExpandedContent(args, output, theme, width, _details) {
    const script = typeof args.script === "string" ? args.script : "";
    const lines = renderContentWithLineNumbers(script, 1, "workflow.js", theme, width);
    const out = (output ?? "").trim();
    if (out) {
      lines.push("");
      lines.push(theme.fg("muted", "── output ──"));
      lines.push(...formatExpandedToolOutputLines(output ?? "", theme, width));
    }
    return lines;
  },
};
