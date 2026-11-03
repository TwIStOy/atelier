import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
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

function composeCommandHeader(
  args: BashArgs,
  theme: Theme,
  title: string,
  cwd: string,
  width: number | undefined,
  desc: string,
): string {
  const cmd = args?.command ?? "";
  const titlePart = `${theme.fg("toolTitle", theme.bold(title))} `;
  const cwdPart = cwd ? ` ${theme.fg("dim", `in ${shortenPath(cwd)}`)}` : "";
  if (desc) return `${titlePart}${theme.fg("accent", desc)}${cwdPart}`;
  if (width === undefined || visibleWidth(cmd) <= singleLineBudget(title, cwd, width)) {
    return `${titlePart}${theme.fg("muted", cmd)}${cwdPart}`;
  }
  const wrapWidth = continuationWrapWidth(title, cwd, width);
  const lines = wrapTextWithAnsi(cmd, wrapWidth).map((line) => theme.fg("muted", line));
  if (lines.length === 1) return `${titlePart}${lines[0]}${cwdPart}`;
  return [`${titlePart}${lines[0]}`, ...lines.slice(1, -1), `${lines[lines.length - 1]}${cwdPart}`].join("\n");
}

function applyAnnotationSuffix(
  header: string,
  headerAnnotation: string | undefined,
  lineCount: string,
  desc: string,
  width: number | undefined,
  theme: Theme,
): string | undefined {
  if (!headerAnnotation) return undefined;
  const annotation = theme.fg("muted", `· ${headerAnnotation}`);
  const suffix = [lineCount, annotation].filter(Boolean).join(" ");
  if (width !== undefined && visibleWidth(suffix) + 5 > width) return undefined;
  const headerLines = header.split("\n");
  const last = headerLines.at(-1) ?? "";
  if (!desc && width !== undefined && visibleWidth(last) + 1 + visibleWidth(suffix) > width) {
    return [...headerLines, suffix].join("\n");
  }
  const label = width === undefined ? last : truncateToWidth(last, width - visibleWidth(suffix) - 1, "…");
  headerLines[headerLines.length - 1] = `${label} ${suffix}`;
  return headerLines.join("\n");
}

function applyLineCountSuffix(header: string, suffix: string, width: number | undefined): string {
  if (!suffix || width === undefined) return header;
  const headerLines = header.split("\n");
  const last = headerLines[headerLines.length - 1] ?? "";
  if (visibleWidth(last) + 1 + visibleWidth(suffix) > width) return header;
  headerLines[headerLines.length - 1] = `${last} ${suffix}`;
  return headerLines.join("\n");
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
    headerAnnotation?: string,
  ) {
    const desc = args?.description ?? "";
    const cwd = args?.workdir ?? "";
    const title = isPartial ? PARTIAL_TITLE : SETTLED_TITLE;

    const header = composeCommandHeader(args, theme, title, cwd, width, desc);
    const lineCount = outputLineSuffix(output, theme);
    const annotated = applyAnnotationSuffix(header, headerAnnotation, lineCount, desc, width, theme);
    if (annotated !== undefined) return annotated;
    return applyLineCountSuffix(header, lineCount, width);
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
