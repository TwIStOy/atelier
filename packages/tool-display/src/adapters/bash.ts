import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { shortenPath, trimTrailingEmpty } from "@htwang-contrib/common";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines, INDENT } from "./shared.ts";

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

function outputLineSuffix(output: string | undefined, theme: Theme): string {
  if (!output) return "";
  const count = trimTrailingEmpty(output.split("\n")).length;
  if (count === 0) return "";
  return theme.fg("dim", `· ${count} line${count !== 1 ? "s" : ""}`);
}

export const bashAdapter: ToolDisplayAdapter<BashArgs> = {
  formatCallHeader(
    args,
    theme,
    _details?: unknown,
    _isPartial?: boolean,
    _expanded?: boolean,
    width?: number,
    output?: string,
  ) {
    const cmd = args?.command ?? "";
    const desc = args?.description ?? "";
    const cwd = args?.workdir ?? "";

    const titlePart = `${theme.fg("toolTitle", theme.bold(TITLE))} `;
    const cwdPart = cwd ? ` ${theme.fg("dim", `in ${shortenPath(cwd)}`)}` : "";

    let header: string;
    let lastLineBudget: number | undefined;

    if (desc) {
      header = `${titlePart}${theme.fg("accent", desc)}${cwdPart}`;
      if (width !== undefined) lastLineBudget = width - STATUS_PREFIX_WIDTH;
    } else if (width === undefined || visibleWidth(cmd) <= singleLineBudget(cwd, width)) {
      header = `${titlePart}${theme.fg("muted", cmd)}${cwdPart}`;
      if (width !== undefined) lastLineBudget = width - STATUS_PREFIX_WIDTH;
    } else {
      const wrapWidth = continuationWrapWidth(cwd, width);
      const lines = wrapTextWithAnsi(cmd, wrapWidth).map((line) => theme.fg("muted", line));

      if (lines.length === 1) {
        header = `${titlePart}${lines[0]}${cwdPart}`;
        lastLineBudget = width - STATUS_PREFIX_WIDTH;
      } else {
        header = [`${titlePart}${lines[0]}`, ...lines.slice(1, -1), `${lines[lines.length - 1]}${cwdPart}`].join("\n");
        lastLineBudget = width - CONTINUATION_INDENT_WIDTH;
      }
    }

    const suffix = outputLineSuffix(output, theme);
    if (suffix && lastLineBudget !== undefined) {
      const headerLines = header.split("\n");
      const last = headerLines[headerLines.length - 1] ?? "";
      if (visibleWidth(last) + 1 + visibleWidth(suffix) <= lastLineBudget) {
        headerLines[headerLines.length - 1] = `${last} ${suffix}`;
        header = headerLines.join("\n");
      }
    }

    return header;
  },

  formatCollapsedContent() {
    return [];
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
