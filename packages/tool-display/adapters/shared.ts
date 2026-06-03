import {
  getLanguageFromPath,
  highlightCode,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { trimTrailingEmpty } from "@htwang-contrib/common";

export const INDENT = "    ";

export function formatExpandedToolOutputLines(
  output: string,
  theme: Theme,
  width: number,
): string[] {
  if (!output) return [];
  const inner = Math.max(1, width - visibleWidth(INDENT));
  return output
    .split("\n")
    .map(
      (line) =>
        INDENT + truncateToWidth(theme.fg("toolOutput", line), inner, "…"),
    );
}

export function replaceTabs(text: string): string {
  return text.replace(/\t/g, "   ");
}

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

export function renderContentWithLineNumbers(
  content: string,
  startLine: number,
  filePath: string,
  theme: Theme,
  width: number,
): string[] {
  if (!content) return [];

  const lang = filePath ? getLanguageFromPath(filePath) : undefined;
  const rawLines = trimTrailingEmpty(
    lang
      ? highlightCode(replaceTabs(content), lang)
      : content.split("\n").map((l) => theme.fg("toolOutput", replaceTabs(l))),
  );

  if (rawLines.length === 0) return [];

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
}

export function formatLineCount(content: string, theme: Theme): string[] {
  const rawLines = trimTrailingEmpty(content.split("\n"));
  const count = rawLines.length;
  if (count === 0) return [theme.fg("muted", "└ empty")];
  return [theme.fg("muted", `└ ${count} line${count !== 1 ? "s" : ""}`)];
}
