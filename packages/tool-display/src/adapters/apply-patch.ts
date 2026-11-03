import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { countPatchChanges, extractPatchedPaths, parsePatch } from "@htwang-contrib/apply-patch/patch";
import type { ApplyPatchPreviewFile, ApplyPatchToolDetails } from "@htwang-contrib/apply-patch/preview";
import { shortenPath } from "@htwang-contrib/common";
import { loadConfig } from "../config.ts";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines, renderChangeBar, renderWithDelta, resolveIsSplit } from "./shared.ts";

interface ApplyPatchArgs {
  input?: string;
}

let memoInput: string | undefined;
let memoPaths: string[] = [];
let memoCounts: { added: number; removed: number } | null = null;

function ensureMemo(input: string): void {
  if (memoInput === input) return;
  memoInput = input;
  memoPaths = extractPatchedPaths(input);
  try {
    const hunks = parsePatch(input);
    memoCounts = hunks.length > 0 ? countPatchChanges(hunks) : null;
  } catch {
    memoCounts = null;
  }
}

function patchedPaths(input: string): string[] {
  ensureMemo(input);
  return memoPaths;
}

function patchCounts(input: string): { added: number; removed: number } | null {
  ensureMemo(input);
  return memoCounts;
}

function toDetails(details: unknown): ApplyPatchToolDetails | undefined {
  if (details == null || typeof details !== "object") return undefined;
  return details as ApplyPatchToolDetails;
}

function formatPatchPath(filePath: string, movePath: string | undefined): string {
  const base = shortenPath(filePath);
  return movePath ? `${base} → ${shortenPath(movePath)}` : base;
}

function formatPatchStats(
  args: ApplyPatchArgs,
  theme: Theme,
  width: number | undefined,
  details: unknown,
  isPartial: boolean | undefined,
): string {
  const d = toDetails(details);
  const counts = patchStatsCounts(args, d);
  const fileCount = patchFileCount(args, d);
  const parts = [
    progressPart(theme, d, isPartial),
    counts.added > 0 ? theme.fg("success", `+${counts.added}`) : "",
    counts.removed > 0 ? theme.fg("error", `-${counts.removed}`) : "",
    diffModePart(theme, counts.known, width),
    fileCount > 1 ? theme.fg("muted", `· ${fileCount} files`) : "",
    failuresPart(theme, d),
    counts.added > 0 || counts.removed > 0 ? renderChangeBar(counts.added, counts.removed, theme) : "",
  ].filter((part) => part !== "");
  return parts.join(" ");
}

function patchStatsCounts(
  args: ApplyPatchArgs,
  d: ApplyPatchToolDetails | undefined,
): { added: number; removed: number; known: boolean } {
  const preview = d?.preview;
  if (preview !== undefined) return { added: preview.added, removed: preview.removed, known: true };
  const counts = patchCounts(args?.input ?? "");
  return { added: counts?.added ?? 0, removed: counts?.removed ?? 0, known: counts !== null };
}

function patchFileCount(args: ApplyPatchArgs, d: ApplyPatchToolDetails | undefined): number {
  return d?.preview?.files.length ?? patchedPaths(args?.input ?? "").length;
}

function progressPart(theme: Theme, d: ApplyPatchToolDetails | undefined, isPartial: boolean | undefined): string {
  if (!isPartial || !d?.progress) return "";
  return theme.fg("muted", `${d.progress.applied + d.progress.failed}/${d.progress.total}`);
}

function diffModePart(theme: Theme, known: boolean, width: number | undefined): string {
  if (!known || width === undefined) return "";
  return theme.fg("muted", resolveIsSplit(width) ? "side-by-side" : "unified");
}

function failuresPart(theme: Theme, d: ApplyPatchToolDetails | undefined): string {
  if (!d?.result || d.result.failures.length === 0) return "";
  return theme.fg("error", `✗ ${d.result.failures.length} failed`);
}

function singleFilePatchLines(file: ApplyPatchPreviewFile | undefined, theme: Theme, width: number): string[] {
  if (!file) return [];
  if (file.diff) return renderWithDelta(file.diff, width, theme);
  const target = file.movePath ? ` → ${shortenPath(file.movePath)}` : "";
  return [theme.fg("muted", `└ ${file.operation} ${shortenPath(file.filePath)}${target}`)];
}

function multiFilePatchLines(files: ApplyPatchPreviewFile[], theme: Theme, width: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) continue;
    lines.push(multiFileHeader(file, i === files.length - 1, theme));
    if (file.diff) {
      lines.push(...renderWithDelta(file.diff, width, theme));
    }
  }
  return lines;
}

function appendStatsSuffix(header: string, suffix: string, width: number | undefined): string {
  if (!suffix) return header;
  if (width !== undefined && visibleWidth(header) + 1 + visibleWidth(suffix) > width) return header;
  return `${header} ${suffix}`;
}

function multiFileHeader(file: ApplyPatchPreviewFile, isLast: boolean, theme: Theme): string {
  const branch = isLast ? "└" : "├";
  const header = `${theme.fg("muted", branch)} ${theme.fg("accent", formatPatchPath(file.filePath, file.movePath))}`;
  const stats: string[] = [];
  if (file.added > 0) stats.push(theme.fg("success", `+${file.added}`));
  if (file.removed > 0) stats.push(theme.fg("error", `-${file.removed}`));
  return stats.length > 0 ? `${header} ${stats.join(" ")}` : header;
}

export const applyPatchAdapter: ToolDisplayAdapter<ApplyPatchArgs> = {
  formatCallHeader(args, theme, details?: unknown, isPartial?: boolean, _expanded?: boolean, width?: number) {
    const title = theme.fg("toolTitle", theme.bold("ApplyPatch"));
    const paths = patchedPaths(args?.input ?? "");
    if (paths.length === 0) {
      return `${title} ${theme.fg("toolOutput", "...")}`;
    }

    let header = `${title} ${theme.fg("accent", shortenPath(paths[0] ?? ""))}`;
    if (paths.length > 1) {
      header += ` ${theme.fg("toolOutput", `+${paths.length - 1} more`)}`;
    }

    if (loadConfig().applyPatchStyle !== "single-line") return header;

    const suffix = formatPatchStats(args, theme, width, details, isPartial);
    return appendStatsSuffix(header, suffix, width);
  },

  formatCollapsedContent(args, _output, theme, width, details?: unknown, isPartial?: boolean) {
    if (loadConfig().applyPatchStyle === "single-line") return [];

    const parts = ["└ patch", formatPatchStats(args, theme, width, details, isPartial)].filter(Boolean);
    return [theme.fg("muted", parts.join(" "))];
  },

  formatExpandedContent(args, _output, theme, width, details?: unknown) {
    const d = toDetails(details);
    const preview = d?.preview;

    if (!preview || preview.files.length === 0) return rawInputLines(args, theme, width);

    const lines =
      preview.files.length === 1
        ? singleFilePatchLines(preview.files[0], theme, width)
        : multiFilePatchLines(preview.files, theme, width);
    lines.push(...failureLines(d, theme));

    return lines;
  },
};

function rawInputLines(args: ApplyPatchArgs, theme: Theme, width: number): string[] {
  const input = args?.input ?? "";
  if (!input.trim()) return [];
  return formatExpandedToolOutputLines(input, theme, width);
}

function failureLines(d: ApplyPatchToolDetails | undefined, theme: Theme): string[] {
  const lines: string[] = [];
  for (const failure of d?.result?.failures ?? []) {
    const message = failure.message.split("\n")[0] ?? failure.message;
    lines.push(theme.fg("error", `✗ ${failure.filePath} (${failure.operation}): ${message}`));
  }
  return lines;
}
