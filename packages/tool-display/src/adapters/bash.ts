import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { shortenPath } from "@htwang-contrib/common";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines, formatLineCount, INDENT } from "./shared.ts";

interface BashArgs {
  command?: string;
  description?: string;
  workdir?: string;
}

const TITLE = "Bash";
const STATUS_PREFIX_WIDTH = 2;
const CONTINUATION_INDENT_WIDTH = 4;

function firstLinePrefixWidth(): number {
  return visibleWidth(TITLE) + 1;
}

function lastLineSuffixWidth(cwd: string): number {
  return cwd ? visibleWidth(` in ${shortenPath(cwd)}`) : 0;
}

function singleLineBudget(cwd: string, width: number): number {
  return Math.max(1, width - STATUS_PREFIX_WIDTH - firstLinePrefixWidth() - lastLineSuffixWidth(cwd));
}

function continuationWrapWidth(cwd: string, width: number): number {
  const first = width - STATUS_PREFIX_WIDTH - firstLinePrefixWidth();
  const middle = width - CONTINUATION_INDENT_WIDTH;
  const last = width - CONTINUATION_INDENT_WIDTH - lastLineSuffixWidth(cwd);
  return Math.max(1, Math.min(first, middle, last));
}

export const bashAdapter: ToolDisplayAdapter<BashArgs> = {
  formatCallHeader(args, theme, _details?: unknown, _isPartial?: boolean, _expanded?: boolean, width?: number) {
    const cmd = args?.command ?? "";
    const desc = args?.description ?? "";
    const cwd = args?.workdir ?? "";

    const titlePart = `${theme.fg("toolTitle", theme.bold(TITLE))} `;
    const cwdPart = cwd ? ` ${theme.fg("dim", `in ${shortenPath(cwd)}`)}` : "";

    if (desc) {
      return `${titlePart}${theme.fg("accent", desc)}${cwdPart}`;
    }

    if (width === undefined || visibleWidth(cmd) <= singleLineBudget(cwd, width)) {
      return `${titlePart}${theme.fg("muted", cmd)}${cwdPart}`;
    }

    const wrapWidth = continuationWrapWidth(cwd, width);
    const lines = wrapTextWithAnsi(cmd, wrapWidth).map((line) => theme.fg("muted", line));

    if (lines.length === 1) {
      return `${titlePart}${lines[0]}${cwdPart}`;
    }

    const firstLine = `${titlePart}${lines[0]}`;
    const middle = lines.slice(1, -1);
    const lastLine = `${lines[lines.length - 1]}${cwdPart}`;
    return [firstLine, ...middle, lastLine].join("\n");
  },

  formatCollapsedContent(_args, output, theme, _width, _details?: unknown, _isPartial?: boolean, _spinAt?: number) {
    if (!output) return [];
    return formatLineCount(output, theme);
  },

  formatExpandedContent(args, output, theme, width, _details?: unknown) {
    const cmd = args?.command ?? "";
    const desc = args?.description ?? "";
    const outputLines = formatExpandedToolOutputLines(output ?? "", theme, width);
    if (!desc || !cmd) return outputLines;
    const inner = Math.max(1, width - visibleWidth(INDENT) - 2);
    const cmdLines = wrapTextWithAnsi(cmd, inner).map(
      (line, i) => `${INDENT}${theme.fg("muted", `${i === 0 ? "$ " : "  "}${line}`)}`,
    );
    return [...cmdLines, ...outputLines];
  },
};
