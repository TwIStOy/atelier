import {
  getLanguageFromPath,
  highlightCode,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { shortenPath } from "@htwang-contrib/common";
import type { ToolDisplayAdapter } from "../types.ts";

function replaceTabs(text: string): string {
  return text.replace(/\t/g, "   ");
}

function trimTrailingEmpty(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end--;
  return lines.slice(0, end);
}

function formatLineRange(args: ReadArgs, theme: Theme): string {
  if (args?.offset === undefined && args?.limit === undefined) return "";
  const startLine = args.offset ?? 1;
  const endLine =
    args.limit !== undefined ? String(startLine + args.limit - 1) : "";
  return theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
}

const INDENT = "    ";

function formatLineNumber(num: number, maxNum: number, theme: Theme): string {
  const width = String(maxNum).length;
  const numStr = String(num).padStart(width);
  return theme.fg("dim", numStr) + " │ ";
}

function formatContinuationPrefix(maxNum: number, theme: Theme): string {
  const width = String(maxNum).length;
  return theme.fg("dim", " ".repeat(width)) + " ╎ ";
}

function gutterVisibleWidth(maxNum: number): number {
  return String(maxNum).length + 3;
}

interface ReadArgs {
  path?: string;
  file_path?: string;
  offset?: number;
  limit?: number;
}

export const readAdapter: ToolDisplayAdapter<ReadArgs> = {
  formatCallHeader(args, theme) {
    const rawPath = args?.file_path ?? args?.path ?? "";
    const path = shortenPath(rawPath);
    const pathDisplay = path
      ? theme.fg("accent", path)
      : theme.fg("toolOutput", "...");
    return (
      theme.fg("toolTitle", theme.bold("read")) +
      " " +
      pathDisplay +
      formatLineRange(args, theme)
    );
  },

  formatCollapsedContent(args, output, theme, _width) {
    if (!output) return [];
    const rawLines = trimTrailingEmpty(output.split("\n"));
    const count = rawLines.length;
    return [theme.fg("muted", `└ ${count} line${count !== 1 ? "s" : ""}`)];
  },

  formatExpandedContent(args, output, theme, width) {
    if (!output) return [];

    const rawPath = args?.file_path ?? args?.path ?? "";
    const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
    const rawLines = trimTrailingEmpty(
      lang
        ? highlightCode(replaceTabs(output), lang)
        : output.split("\n").map((l) => theme.fg("toolOutput", replaceTabs(l))),
    );

    if (rawLines.length === 0) return [];

    const startLine = args?.offset ?? 1;
    const endLine = startLine + rawLines.length - 1;
    const gw = gutterVisibleWidth(endLine);
    const contentWidth = Math.max(1, width - INDENT.length - gw);

    const lines: string[] = [];

    for (let i = 0; i < rawLines.length; i++) {
      const lineNum = startLine + i;
      const gutter = formatLineNumber(lineNum, endLine, theme);
      const codeLine = lang ? replaceTabs(rawLines[i]) : rawLines[i];
      const wrapped = wrapTextWithAnsi(codeLine, contentWidth);
      lines.push(INDENT + gutter + wrapped[0]);
      if (wrapped.length > 1) {
        const contPrefix = formatContinuationPrefix(endLine, theme);
        for (let j = 1; j < wrapped.length; j++) {
          lines.push(INDENT + contPrefix + wrapped[j]);
        }
      }
    }

    return lines;
  },
};
