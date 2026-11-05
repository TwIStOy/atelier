import { execFile } from "node:child_process";
import { getLanguageFromPath, highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { AsyncAnnotations, createLogger, extractAnsiRgb, shortenPath, trimTrailingEmpty } from "@htwang-contrib/common";
import { loadConfig } from "../config.ts";
import type { ToolDisplayAdapter } from "../types.ts";

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

  const q = (flag: string, value: string) => args.push(`${flag}=${value}`);

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

// `delta` renders run as async child processes so the render path never blocks
// on a spawn (which previously stalled the event loop up to the 5s timeout,
// once per file for multi-file patches). Renders before a result lands use the
// plain-diff fallback; the version bump + invalidator on completion make the
// callers' render caches re-render with the styled lines.
const DELTA_CACHE_MAX_ENTRIES = 48;
const DELTA_SPAWN_TIMEOUT_MS = 5000;
const DELTA_MAX_BUFFER = 1024 * 1024;
const DELTA_DIFF_HEADER_RE = /^(diff --git|---|\+\+\+)/;

let deltaRenderVersion = 0;
let invalidateTui: (() => void) | undefined;
const deltaLogger = createLogger("tool-display");

const deltaResults = new AsyncAnnotations<string[]>(
  () => {
    deltaRenderVersion++;
    invalidateTui?.();
  },
  (error) => deltaLogger.warn(`delta render failed: ${String(error)}`),
);

export function currentDeltaRenderVersion(): number {
  return deltaRenderVersion;
}

export function setDeltaRenderInvalidator(invalidate: (() => void) | undefined): void {
  invalidateTui = invalidate;
}

function fallbackDeltaLines(unifiedDiff: string, width: number): string[] {
  return unifiedDiff
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => truncateToWidth(line, width, "…"));
}

function runDelta(args: string[], unifiedDiff: string, width: number, signal: AbortSignal): Promise<string[]> {
  return new Promise((resolve) => {
    const child = execFile(
      "delta",
      args,
      { encoding: "utf-8", timeout: DELTA_SPAWN_TIMEOUT_MS, maxBuffer: DELTA_MAX_BUFFER, signal },
      (error, stdout) => {
        if (error || typeof stdout !== "string") {
          resolve(fallbackDeltaLines(unifiedDiff, width));
          return;
        }
        resolve(
          stdout
            .split("\n")
            .filter((line) => line.length > 0 && !DELTA_DIFF_HEADER_RE.test(line))
            .map((line) => truncateToWidth(replaceTabs(line), width, "")),
        );
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(unifiedDiff);
  });
}

export function renderWithDelta(unifiedDiff: string, width: number, theme: Theme): string[] {
  const innerWidth = Math.max(1, width);
  const isSplit = resolveIsSplit(innerWidth);
  const styles = probeDeltaStyles(theme);

  const deltaArgs = styles
    ? buildDeltaArgs(styles, isSplit, innerWidth)
    : ["delta", isSplit ? "--side-by-side" : "--color-only", `--width=${innerWidth}`];

  if (deltaResults.size() > DELTA_CACHE_MAX_ENTRIES) deltaResults.reset();

  const key = `${deltaArgs.join("\u0000")}\u0000${unifiedDiff}`;
  const cached = deltaResults.get(key);
  if (cached) return cached;
  deltaResults.request(key, (signal) => runDelta(deltaArgs.slice(1), unifiedDiff, width, signal));
  return fallbackDeltaLines(unifiedDiff, width);
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

function replaceTabs(text: string): string {
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

/** First `limit` content lines in dim style with a `└ … N more line(s)` footer. */
export function formatDimPreviewLines(content: string, theme: Theme, width: number, limit = 20): string[] {
  if (!content) return [];
  const allLines = content.split(/\r?\n/);
  const lines = allLines.slice(0, limit).map((line) => truncateToWidth(theme.fg("dim", line), Math.max(1, width), "…"));
  if (allLines.length > limit) {
    lines.push(theme.fg("muted", `└ … ${allLines.length - limit} more line(s)`));
  }
  return lines;
}

/** Render up to `limit` items and append a `└ … N more <noun>(s)` footer. */
export function listLines<T>(
  items: readonly T[],
  total: number,
  limit: number,
  noun: string,
  theme: Theme,
  render: (item: T) => string[],
): string[] {
  const lines: string[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    lines.push(...render(items[i]!));
  }
  if (total > limit) {
    lines.push(theme.fg("muted", `└ … ${total - limit} more ${noun}${total - limit === 1 ? "" : "s"}`));
  }
  return lines;
}

/** `N <noun>s <first> · N-1 more` summary, or `emptyLabel` when nothing matched. */
export function countFirstSummary(
  theme: Theme,
  noun: string,
  emptyLabel: string,
  total: number,
  first: string,
): string {
  if (total === 0) return theme.fg("muted", emptyLabel);
  const more = total > 1 ? theme.fg("dim", ` · ${total - 1} more`) : "";
  return `${theme.fg("success", `${total} ${noun}${total === 1 ? "" : "s"}`)} ${theme.fg("dim", first)}${more}`;
}

function fieldOf(details: unknown, key: string): unknown {
  if (details == null || typeof details !== "object") return undefined;
  return (details as Record<string, unknown>)[key];
}

export function stringField(details: unknown, key: string): string | undefined {
  const v = fieldOf(details, key);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function numberField(details: unknown, key: string): number | undefined {
  const v = fieldOf(details, key);
  return typeof v === "number" ? v : undefined;
}

/** Dim ` (backend)` tag appended to tool titles when details carry a backend. */
export function backendTag(theme: Theme, details: unknown): string {
  const backend = stringField(details, "backend");
  return backend ? ` ${theme.fg("dim", `(${backend})`)}` : "";
}

/** Accent-styled shortened file path for edit/write headers. */
export function filePathDisplay(args: { file_path?: string; path?: string } | undefined, theme: Theme): string {
  const path = shortenPath(rawPathOf(args));
  return path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
}

function pathField(args: { path?: string } | undefined): string {
  return args?.path ?? "";
}

/** Raw (unshortened) `file_path`/`path` from tool args, or an empty string. */
export function rawPathOf(args: { file_path?: string; path?: string } | undefined): string {
  return args?.file_path ?? pathField(args);
}

/** `Title <label> · settled/total <noun>` header, width-truncated. */
export function batchHeader(
  theme: Theme,
  title: string,
  label: string,
  stats: { settled: number; total: number } | undefined,
  statsNoun: string,
  width: number | undefined,
): string {
  const statsText = stats ? theme.fg("muted", ` · ${stats.settled}/${stats.total} ${statsNoun}`) : "";
  const header = `${theme.fg("toolTitle", theme.bold(title))} ${theme.fg("accent", label)}${statsText}`;
  if (width !== undefined && visibleWidth(header) > width) {
    return truncateToWidth(header, width, "…");
  }
  return header;
}

/**
 * Collapsed/expanded content pair for read-only list tools: a one-line count
 * summary from `details` when present, falling back to a line count, and raw
 * output lines when expanded.
 */
export function outputContentMethods(
  countMessage: (details: unknown) => string | undefined,
): Pick<ToolDisplayAdapter, "formatCollapsedContent" | "formatExpandedContent"> {
  return {
    formatCollapsedContent(_args, output, theme, _width, details, isPartial) {
      if (isPartial) return [];
      const msg = countMessage(details);
      if (msg !== undefined) return [theme.fg("muted", `└ ${msg}`)];
      if (!output) return [];
      return formatLineCount(output, theme);
    },
    formatExpandedContent(_args, output, theme, width) {
      return formatExpandedToolOutputLines(output ?? "", theme, width);
    },
  };
}
