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
    const label = theme.fg("toolTitle", theme.bold("Create Goal"));
    const obj = objectivePreview(args, theme, 80);
    return obj ? `${label} ${obj}` : label;
  },

  formatCollapsedContent(_args, output, theme, width, details) {
    if (!output) return [];
    const d = details as Record<string, unknown> | undefined;
    const status = typeof d?.status === "string" ? d.status : "";
    const statusText =
      status === "active"
        ? theme.fg("success", "● active")
        : theme.fg("muted", status);
    return [
      truncateToWidth(
        `${INDENT}└ ${statusText} — ${firstLine(output)}`,
        width,
        "…",
      ),
    ];
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
    const label = theme.fg("toolTitle", theme.bold("Update Goal"));
    const statusLabel = theme.fg("accent", `→ ${statusVal}`);
    return `${label} ${statusLabel}`;
  },

  formatCollapsedContent(_args, output, theme, width, details) {
    if (!output) return [];
    const d = details as Record<string, unknown> | undefined;
    const status = typeof d?.status === "string" ? d.status : "";
    const icon =
      status === "complete"
        ? theme.fg("success", "✓ complete")
        : theme.fg("muted", status);
    return [truncateToWidth(`${INDENT}└ ${icon}`, width, "…")];
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
    return theme.fg("toolTitle", theme.bold("Get Goal"));
  },

  formatCollapsedContent(_args, output, theme, width, details) {
    if (!output) return [];
    const d = details as Record<string, unknown> | undefined;
    const goal = d?.goal;
    if (goal === null || goal === undefined) {
      return [`${INDENT}└ ${theme.fg("muted", "no goal set")}`];
    }
    return [truncateToWidth(`${INDENT}└ ${firstLine(output)}`, width, "…")];
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
