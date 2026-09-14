import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { shortenPath, trimTrailingEmpty } from "@htwang-contrib/common";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines } from "./shared.ts";

interface BashArgs {
  command?: string;
  description?: string;
  workdir?: string;
}

const PARTIAL_TITLE = "Running";
const SETTLED_TITLE = "Ran";

function firstLinePrefixWidth(title: string): number {
  return visibleWidth(title) + 1;
}

function lastLineSuffixWidth(cwd: string): number {
  return cwd ? visibleWidth(` in ${shortenPath(cwd)}`) : 0;
}

function singleLineBudget(title: string, cwd: string, width: number): number {
  return Math.max(1, width - firstLinePrefixWidth(title) - lastLineSuffixWidth(cwd));
}

function continuationWrapWidth(title: string, cwd: string, width: number): number {
  return Math.max(1, Math.min(width - firstLinePrefixWidth(title), width - lastLineSuffixWidth(cwd)));
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
    isPartial?: boolean,
    _expanded?: boolean,
    width?: number,
    output?: string,
  ) {
    const cmd = args?.command ?? "";
    const desc = args?.description ?? "";
    const cwd = args?.workdir ?? "";

    const title = isPartial ? PARTIAL_TITLE : SETTLED_TITLE;
    const titlePart = `${theme.fg("toolTitle", theme.bold(title))} `;
    const cwdPart = cwd ? ` ${theme.fg("dim", `in ${shortenPath(cwd)}`)}` : "";

    let header: string;
    let lastLineBudget: number | undefined;

    if (desc) {
      header = `${titlePart}${theme.fg("accent", desc)}${cwdPart}`;
      if (width !== undefined) lastLineBudget = width;
    } else if (width === undefined || visibleWidth(cmd) <= singleLineBudget(title, cwd, width)) {
      header = `${titlePart}${theme.fg("muted", cmd)}${cwdPart}`;
      if (width !== undefined) lastLineBudget = width;
    } else {
      const wrapWidth = continuationWrapWidth(title, cwd, width);
      const lines = wrapTextWithAnsi(cmd, wrapWidth).map((line) => theme.fg("muted", line));

      if (lines.length === 1) {
        header = `${titlePart}${lines[0]}${cwdPart}`;
        lastLineBudget = width;
      } else {
        header = [`${titlePart}${lines[0]}`, ...lines.slice(1, -1), `${lines[lines.length - 1]}${cwdPart}`].join("\n");
        lastLineBudget = width;
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
    const inner = Math.max(1, width - 2);
    const cmdLines = wrapTextWithAnsi(cmd, inner).map((line, i) =>
      theme.fg("muted", `${i === 0 ? "$ " : "  "}${line}`),
    );
    return [...cmdLines, ...outputLines];
  },
};
