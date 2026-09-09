import { execSync } from "node:child_process";
import { getLanguageFromPath, highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { extractAnsiRgb, trimTrailingEmpty } from "@htwang-contrib/common";
import { loadConfig } from "../config.ts";

const BAR_WIDTH = 6;

interface DeltaStyles {
  base: string;
  red: string;
  green: string;
  text: string;
  overlay0: string;
  subtext0: string;
}

function probeDeltaStyles(theme: Theme): DeltaStyles | null {
  const base = extractAnsiRgb(theme.bg("toolPendingBg", "x"));
  const red = extractAnsiRgb(theme.fg("toolDiffRemoved", "x"));
  const green = extractAnsiRgb(theme.fg("toolDiffAdded", "x"));
  const text = extractAnsiRgb(theme.fg("syntaxVariable", "x"));
  const overlay0 = extractAnsiRgb(theme.fg("dim", "x"));
  const subtext0 = extractAnsiRgb(theme.fg("toolOutput", "x"));

  if (!base || !red || !green || !text || !overlay0 || !subtext0) return null;
  return { base, red, green, text, overlay0, subtext0 };
}

function mixHex(a: string, ratioA: number, b: string, ratioB: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const total = ratioA + ratioB;
  return (
    "#" +
    pa
      .map((v, i) =>
        Math.round((v * ratioA + pb[i] * ratioB) / total)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function buildDeltaArgs(styles: DeltaStyles, isSplit: boolean, width: number): string[] {
  const args = ["delta", isSplit ? "--side-by-side" : "--color-only", `--width=${width}`];

  const q = (flag: string, value: string) => args.push(`${flag}="${value}"`);

  q("--file-style", "omit");
  q("--file-decoration-style", "omit");
  q("--hunk-header-style", "omit");
  q("--hunk-header-decoration-style", "omit");

  args.push("--line-numbers");
  q("--line-numbers-left-style", styles.overlay0);
  q("--line-numbers-minus-style", `bold ${styles.red}`);
  q("--line-numbers-plus-style", `bold ${styles.green}`);
  q("--line-numbers-right-style", styles.overlay0);
  q("--line-numbers-zero-style", styles.overlay0);

  q("--minus-style", `syntax ${mixHex(styles.red, 20, styles.base, 80)}`);
  q("--minus-emph-style", `bold syntax ${mixHex(styles.red, 35, styles.base, 65)}`);
  q("--plus-style", `syntax ${mixHex(styles.green, 20, styles.base, 80)}`);
  q("--plus-emph-style", `bold syntax ${mixHex(styles.green, 35, styles.base, 65)}`);

  return args;
}

export function resolveIsSplit(innerWidth: number): boolean {
  const cfg = loadConfig();
  if (cfg.diffMode === "side-by-side") return true;
  if (cfg.diffMode === "unified") return false;
  return innerWidth >= cfg.splitDiffMinWidth;
}

export function renderWithDelta(unifiedDiff: string, width: number, theme: Theme): string[] {
  const innerWidth = Math.max(1, width);
  const isSplit = resolveIsSplit(innerWidth);
  const styles = probeDeltaStyles(theme);

  const deltaArgs = styles
    ? buildDeltaArgs(styles, isSplit, innerWidth)
    : ["delta", isSplit ? "--side-by-side" : "--color-only", `--width=${innerWidth}`];

  const diffHeaderRe = /^(diff --git|---|\+\+\+)/;
  try {
    const result = execSync(deltaArgs.join(" "), {
      input: unifiedDiff,
      encoding: "utf-8",
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    return result
      .split("\n")
      .filter((line) => line.length > 0 && !diffHeaderRe.test(line))
      .map((line) => truncateToWidth(replaceTabs(line), width, ""));
  } catch {
    return unifiedDiff
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => truncateToWidth(line, width, "…"));
  }
}

export function renderChangeBar(added: number, removed: number, theme: Theme): string {
  const total = added + removed;
  if (total === 0) return "";
  const removedW = Math.round((BAR_WIDTH * removed) / total);
  const addedW = BAR_WIDTH - removedW;
  return `[${theme.fg("error", "-".repeat(removedW))}${theme.fg("success", "-".repeat(addedW))}]`;
}

export function formatExpandedToolOutputLines(output: string, theme: Theme, width: number): string[] {
  if (!output) return [];
  const inner = Math.max(1, width);
  return output.split("\n").map((line) => truncateToWidth(theme.fg("toolOutput", line), inner, "…"));
}

export function replaceTabs(text: string): string {
  return text.replace(/\t/g, "   ");
}

function formatLineNumber(num: number, maxNum: number, theme: Theme): string {
  const width = String(maxNum).length;
  const numStr = String(num).padStart(width);
  return `${theme.fg("dim", numStr)} │ `;
}

function formatContinuationPrefix(maxNum: number, theme: Theme): string {
  const width = String(maxNum).length;
  return `${theme.fg("dim", " ".repeat(width))} ╎ `;
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
  const contentWidth = Math.max(1, width - gw);

  const lines: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const lineNum = startLine + i;
    const gutter = formatLineNumber(lineNum, endLine, theme);
    const codeLine = lang ? replaceTabs(rawLines[i]) : rawLines[i];
    const wrapped = wrapTextWithAnsi(codeLine, contentWidth);
    lines.push(gutter + wrapped[0]);
    if (wrapped.length > 1) {
      const contPrefix = formatContinuationPrefix(endLine, theme);
      for (let j = 1; j < wrapped.length; j++) {
        lines.push(contPrefix + wrapped[j]);
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
