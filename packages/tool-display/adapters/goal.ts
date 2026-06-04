import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { truncateDisplay } from "@htwang-contrib/common";
import type { ToolDisplayAdapter } from "../types.ts";

interface GoalArgs {
  objective?: string;
  status?: string;
  token_budget?: number;
}

function objectivePreview(
  args: GoalArgs,
  theme: Theme,
  maxLen: number,
): string {
  const obj = args.objective?.trim();
  if (!obj) return "";
  return theme.fg("dim", truncateDisplay(obj, maxLen));
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
    const status = typeof d?.status === "string" ? d.status : "";
    if (status === "active") {
      return [theme.fg("muted", `└ ● active — ${firstLine(output)}`)];
    }
    return [theme.fg("muted", `└ ${status}`)];
  },

  formatExpandedContent(_args, output, theme, width) {
    if (!output) return [];
    return output
      .split("\n")
      .map(
        (line) =>
          INDENT +
          truncateToWidth(theme.fg("toolOutput", line), width - 4, "…"),
      );
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
    if (!output) return [];
    return output
      .split("\n")
      .map(
        (line) =>
          INDENT +
          truncateToWidth(theme.fg("toolOutput", line), width - 4, "…"),
      );
  },
};

export const getGoalAdapter: ToolDisplayAdapter<GoalArgs> = {
  formatCallHeader(_args, theme, _details, _isPartial, _expanded) {
    return theme.fg("toolTitle", theme.bold("GetGoal"));
  },

  formatCollapsedContent(_args, _output, theme, width, details) {
    const d = details as Record<string, unknown> | undefined;
    const hasGoal = d?.id !== undefined && d?.id !== null;
    if (!hasGoal) {
      return [theme.fg("muted", "└ no goal set")];
    }
    const status = typeof d?.status === "string" ? d.status : "unknown";
    const objective = typeof d?.objective === "string" ? d.objective : "";
    const statusGlyph =
      status === "active" ? "●" : status === "complete" ? "✓" : "○";
    const preview = truncateDisplay(objective, width - 10);
    return [theme.fg("muted", `└ ${statusGlyph} ${status} — ${preview}`)];
  },

  formatExpandedContent(_args, output, theme, width) {
    if (!output) return [];
    return output
      .split("\n")
      .map(
        (line) =>
          INDENT +
          truncateToWidth(theme.fg("toolOutput", line), width - 4, "…"),
      );
  },
};

const INDENT = "    ";

function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}
