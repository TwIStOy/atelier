import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateDisplay } from "@htwang-contrib/common/format";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines } from "./shared.ts";

interface GoalArgs {
  objective?: string;
  status?: string;
  token_budget?: number;
}

function objectivePreview(args: GoalArgs, theme: Theme, maxLen: number): string {
  const obj = args.objective?.trim();
  if (!obj) return "";
  return theme.fg("dim", truncateDisplay(obj, maxLen));
}

function statusText(d: Record<string, unknown> | undefined, fallback: string): string {
  return typeof d?.status === "string" ? d.status : fallback;
}

function hasGoalId(d: Record<string, unknown> | undefined): boolean {
  const id = d?.id;
  return id !== undefined && id !== null;
}

function objectiveText(d: Record<string, unknown> | undefined): string {
  return typeof d?.objective === "string" ? d.objective : "";
}

function statusGlyph(status: string): string {
  if (status === "active") return "●";
  if (status === "complete") return "✓";
  return "○";
}

export const createGoalAdapter: ToolDisplayAdapter<GoalArgs> = {
  formatCallHeader(args, theme, _details, _isPartial, _expanded) {
    const label = theme.fg("toolTitle", theme.bold("CreateGoal"));
    const obj = objectivePreview(args, theme, 80);
    return obj ? `${label} ${obj}` : label;
  },

  formatCollapsedContent(_args, output, theme, _width, details) {
    if (!output) return [];
    const d = details as Record<string, unknown> | undefined;
    const status = statusText(d, "");
    if (status === "active") {
      return [theme.fg("muted", `└ ● active — ${firstLine(output)}`)];
    }
    return [theme.fg("muted", `└ ${status}`)];
  },

  formatExpandedContent(_args, output, theme, width) {
    return formatExpandedToolOutputLines(output, theme, width);
  },
};

export const updateGoalAdapter: ToolDisplayAdapter<GoalArgs> = {
  formatCallHeader(args, theme, _details, _isPartial, _expanded) {
    const statusVal = args.status ?? "";
    const label = theme.fg("toolTitle", theme.bold("UpdateGoal"));
    const statusLabel = theme.fg("accent", `→ ${statusVal}`);
    return `${label} ${statusLabel}`;
  },

  formatCollapsedContent(_args, _output, theme, _width, details) {
    const d = details as Record<string, unknown> | undefined;
    const status = typeof d?.status === "string" ? d.status : "";
    if (status === "complete") {
      return [theme.fg("muted", "└ ✓ complete")];
    }
    return [theme.fg("muted", `└ ${status}`)];
  },

  formatExpandedContent(_args, output, theme, width) {
    return formatExpandedToolOutputLines(output, theme, width);
  },
};

export const getGoalAdapter: ToolDisplayAdapter<GoalArgs> = {
  formatCallHeader(_args, theme, _details, _isPartial, _expanded) {
    return theme.fg("toolTitle", theme.bold("GetGoal"));
  },

  formatCollapsedContent(_args, _output, theme, width, details) {
    const d = details as Record<string, unknown> | undefined;
    if (!hasGoalId(d)) {
      return [theme.fg("muted", "└ no goal set")];
    }
    const status = statusText(d, "unknown");
    const preview = truncateDisplay(objectiveText(d), Math.max(1, width - 10));
    return [theme.fg("muted", `└ ${statusGlyph(status)} ${status} — ${preview}`)];
  },

  formatExpandedContent(_args, output, theme, width) {
    return formatExpandedToolOutputLines(output, theme, width);
  },
};

function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}
