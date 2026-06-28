import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { shortenPath } from "@htwang-contrib/common";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines, formatLineCount } from "./shared.ts";

interface BashArgs {
  command?: string;
  description?: string;
  workdir?: string;
}

const TITLE = "Bash";
const STATUS_PREFIX_WIDTH = 2;
const CONTINUATION_INDENT_WIDTH = 4;

function firstLinePrefixWidth(desc: string): number {
  return visibleWidth(TITLE) + 1 + (desc ? visibleWidth(desc) + 2 : 0);
}

function lastLineSuffixWidth(desc: string, cwd: string): number {
  return (desc ? 1 : 0) + (cwd ? visibleWidth(` in ${shortenPath(cwd)}`) : 0);
}

function singleLineBudget(desc: string, cwd: string, width: number): number {
  return Math.max(1, width - STATUS_PREFIX_WIDTH - firstLinePrefixWidth(desc) - lastLineSuffixWidth(desc, cwd));
}

function continuationWrapWidth(desc: string, cwd: string, width: number): number {
  const first = width - STATUS_PREFIX_WIDTH - firstLinePrefixWidth(desc);
  const middle = width - CONTINUATION_INDENT_WIDTH;
  const last = width - CONTINUATION_INDENT_WIDTH - lastLineSuffixWidth(desc, cwd);
  return Math.max(1, Math.min(first, middle, last));
}

export const bashAdapter: ToolDisplayAdapter<BashArgs> = {
  formatCallHeader(args, theme, _details?: unknown, _isPartial?: boolean, _expanded?: boolean, width?: number) {
    const cmd = args?.command ?? "";
    const desc = args?.description ?? "";
    const cwd = args?.workdir ?? "";

    const titlePart = `${theme.fg("toolTitle", theme.bold(TITLE))} `;
    const descPart = desc ? `${theme.fg("dim", desc)} ` : "";
    const openParen = desc ? theme.fg("muted", "(") : "";
    const closeParen = desc ? theme.fg("muted", ")") : "";
    const cwdPart = cwd ? ` ${theme.fg("dim", `in ${shortenPath(cwd)}`)}` : "";

    if (width === undefined || visibleWidth(cmd) <= singleLineBudget(desc, cwd, width)) {
      const styledCmd = theme.fg("muted", cmd);
      return `${titlePart}${descPart}${openParen}${styledCmd}${closeParen}${cwdPart}`;
    }

    const wrapWidth = continuationWrapWidth(desc, cwd, width);
    const lines = wrapTextWithAnsi(cmd, wrapWidth).map((line) => theme.fg("muted", line));

    if (lines.length === 1) {
      return `${titlePart}${descPart}${openParen}${lines[0]}${closeParen}${cwdPart}`;
    }

    const firstLine = `${titlePart}${descPart}${openParen}${lines[0]}`;
    const middle = lines.slice(1, -1);
    const lastLine = `${lines[lines.length - 1]}${closeParen}${cwdPart}`;
    return [firstLine, ...middle, lastLine].join("\n");
  },

  formatCollapsedContent(_args, output, theme, _width, _details?: unknown, _isPartial?: boolean, _spinAt?: number) {
    if (!output) return [];
    return formatLineCount(output, theme);
  },

  formatExpandedContent(_args, output, theme, width, _details?: unknown) {
    return formatExpandedToolOutputLines(output ?? "", theme, width);
  },
};
