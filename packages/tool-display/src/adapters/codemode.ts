import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { truncateDisplay } from "@htwang-contrib/common";
import { formatDuration, spinnerGlyph } from "../format.ts";
import { keyText } from "../key-text.ts";
import { activeRegistryRef } from "../tool-call-display.ts";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines, renderContentWithLineNumbers } from "./shared.ts";

interface CodemodeArgs {
  code?: string;
}

interface CodemodeCall {
  name?: string;
  args?: string;
  status?: string;
  durationMs?: number;
  error?: string;
  cost?: number;
}

interface CodemodeDetails {
  calls?: CodemodeCall[];
  fullOutputPath?: string;
}

const TITLE = "Codemode";
const LABEL_MAX = 40;
const COLLAPSED_ARGS_CHARS = 80;
const COLLAPSED_CALL_COUNT = 8;
const COLLAPSED_ERROR_LINES = 3;

const SCRIPT_HEADER = /^Script (completed|failed)\nWall time [\d.]+ seconds\nOutput:\n/;
const SCRIPT_ERROR = /(?:^|\n)Script error:\n/;

function scriptLabel(args: CodemodeArgs): string {
  const code = typeof args.code === "string" ? args.code : "";
  for (const line of code.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("// @options:")) continue;
    return truncateDisplay(trimmed.replace(/^\/\/\s*/, ""), LABEL_MAX);
  }
  return "…";
}

function asDetails(details: unknown): CodemodeDetails | undefined {
  if (!details || typeof details !== "object") return undefined;
  return details as CodemodeDetails;
}

function stripScriptHeader(output: string): { failed: boolean; body: string } {
  const match = SCRIPT_HEADER.exec(output);
  if (!match) return { failed: false, body: output };
  return { failed: match[1] === "failed", body: output.slice(match[0].length) };
}

function splitScriptError(body: string): { output: string; error?: string } {
  const match = SCRIPT_ERROR.exec(body);
  if (!match) return { output: body };
  return { output: body.slice(0, match.index).trimEnd(), error: body.slice(match.index + match[0].length) };
}

function formatCost(cost: number): string {
  return `$${cost >= 0.01 ? cost.toFixed(2) : cost.toPrecision(2)}`;
}

function callGlyph(theme: Theme, status: string | undefined, isPartial: boolean, spinAt: number): string {
  switch (status) {
    case "ok":
      return theme.fg("success", "✓");
    case "error":
      return theme.fg("error", "✗");
    case "cancelled":
      return theme.fg("muted", "⊘");
    default:
      return isPartial ? spinnerGlyph(theme, spinAt) : theme.fg("accent", "●");
  }
}

// Renders a nested call like its tool's own collapsed header (`Read a.ts`) when an
// adapter is registered and the args preview still parses; falls back to the raw
// name + args preview for unknown tools or truncated JSON.
function nestedCallHeader(call: CodemodeCall, theme: Theme, width: number): string | undefined {
  const name = call.name;
  if (!name) return undefined;
  const adapter = activeRegistryRef.current?.get(name);
  if (!adapter) return undefined;
  let args: unknown;
  try {
    args = JSON.parse(call.args ?? "");
  } catch {
    return undefined;
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  try {
    return adapter.formatCallHeader(
      args as Record<string, unknown>,
      theme,
      undefined,
      call.status === "running",
      false,
      width,
    );
  } catch {
    return undefined;
  }
}

function formatCallRow(
  theme: Theme,
  call: CodemodeCall,
  isPartial: boolean,
  spinAt: number,
  expanded: boolean,
  width: number,
): string {
  const glyph = callGlyph(theme, call.status, isPartial, spinAt);
  let suffix = "";
  if (typeof call.durationMs === "number") suffix += ` ${theme.fg("dim", formatDuration(call.durationMs))}`;
  if (call.cost) suffix += ` ${theme.fg("dim", formatCost(call.cost))}`;

  const header = nestedCallHeader(call, theme, Math.max(1, width - 2));
  let row: string;
  if (header !== undefined) {
    const headerLines = header.split("\n");
    if (headerLines.length === 1 && visibleWidth(headerLines[0]) + visibleWidth(suffix) <= width - 2) {
      headerLines[0] += suffix;
    }
    row = `${glyph} ${headerLines[0]}`;
    if (headerLines.length > 1) {
      row += `\n${headerLines
        .slice(1)
        .map((line) => `  ${line}`)
        .join("\n")}`;
    }
  } else {
    const parts: string[] = [theme.fg("toolTitle", call.name ?? "tool")];
    const argsText = expanded ? (call.args ?? "") : truncateDisplay(call.args ?? "", COLLAPSED_ARGS_CHARS, "...");
    if (argsText) parts.push(theme.fg("muted", argsText));
    row = `${glyph} ${parts.join(" ")}${suffix}`;
  }
  if (expanded && call.error?.trim()) {
    row += `\n    ${theme.fg("error", call.error.split("\n").join("\n    "))}`;
  }
  return row;
}

function settledCounts(details: CodemodeDetails | undefined): { settled: number; total: number } | undefined {
  const calls = details?.calls;
  if (!Array.isArray(calls) || calls.length === 0) return undefined;
  const settled = calls.filter((c) => c.status === "ok" || c.status === "error" || c.status === "cancelled").length;
  return { settled, total: calls.length };
}

function callRows(
  details: CodemodeDetails | undefined,
  theme: Theme,
  width: number,
  isPartial: boolean,
  spinAt: number,
  expanded: boolean,
): string[] {
  const calls = details?.calls;
  if (!Array.isArray(calls) || calls.length === 0) return [];
  const rows: string[] = [];
  const shown = expanded || isPartial ? calls : calls.slice(-COLLAPSED_CALL_COUNT);
  if (shown.length < calls.length) {
    const hidden = calls.length - shown.length;
    rows.push(
      truncateToWidth(
        theme.fg(
          "muted",
          `... (${hidden} earlier call${hidden !== 1 ? "s" : ""}, ${keyText("app.tools.expand")} to expand)`,
        ),
        width,
        "…",
      ),
    );
  }
  for (const call of shown) {
    rows.push(formatCallRow(theme, call, isPartial, spinAt, expanded, width));
  }
  const priced = calls.filter((call) => call.cost);
  if (priced.length > 1) {
    const total = priced.reduce((sum, call) => sum + (call.cost ?? 0), 0);
    rows.push(theme.fg("muted", `Model calls: ${formatCost(total)}`));
  }
  return rows;
}

function collapsedErrorLines(error: string, theme: Theme, width: number): string[] {
  return error
    .split("\n")
    .filter((line) => line.trim())
    .slice(0, COLLAPSED_ERROR_LINES)
    .map((line) => truncateToWidth(theme.fg("error", line), width, "…"));
}

export const codemodeAdapter: ToolDisplayAdapter<CodemodeArgs> = {
  formatCallHeader(args, theme, details, _isPartial, _expanded, width) {
    const title = `${theme.fg("toolTitle", theme.bold(TITLE))} `;
    const label = theme.fg("accent", scriptLabel(args ?? {}));
    let stats = "";
    const counts = settledCounts(asDetails(details));
    if (counts) {
      stats = theme.fg("muted", ` · ${counts.settled}/${counts.total} calls`);
    }
    const header = title + label + stats;
    if (width !== undefined && visibleWidth(header) > width) {
      return truncateToWidth(header, width, "…");
    }
    return header;
  },

  formatCollapsedContent(_args, output, theme, width, details, isPartial, spinAt = Date.now()) {
    if (isPartial) {
      return callRows(asDetails(details), theme, width, true, spinAt, false);
    }
    const rows = callRows(asDetails(details), theme, width, false, spinAt, false);
    const { body } = stripScriptHeader(output ?? "");
    const { error } = splitScriptError(body);
    if (error) {
      rows.push(...collapsedErrorLines(error, theme, width));
    }
    const fullOutputPath = asDetails(details)?.fullOutputPath;
    if (fullOutputPath) {
      rows.push(truncateToWidth(theme.fg("muted", `Full output: ${fullOutputPath}`), width, "…"));
    }
    return rows;
  },

  formatExpandedContent(args, output, theme, width, details) {
    const code = typeof args.code === "string" ? args.code : "";
    const lines = renderContentWithLineNumbers(code, 1, "codemode.js", theme, width);
    const rows = callRows(asDetails(details), theme, width, false, 0, true);
    if (rows.length > 0) {
      lines.push("", theme.fg("muted", "── calls ──"), ...rows);
    }
    const { body } = stripScriptHeader(output ?? "");
    const { output: main, error } = splitScriptError(body);
    if (main.trim()) {
      lines.push("", theme.fg("muted", "── output ──"), ...formatExpandedToolOutputLines(main, theme, width));
    }
    if (error) {
      lines.push(
        "",
        theme.fg("muted", "── error ──"),
        ...error.split("\n").map((line) => truncateToWidth(theme.fg("error", line), Math.max(1, width), "…")),
      );
    }
    return lines;
  },
};
