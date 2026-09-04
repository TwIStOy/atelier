import { countPatchChanges, extractPatchedPaths, parsePatch } from "@htwang-contrib/apply-patch/patch";
import type { ApplyPatchToolDetails } from "@htwang-contrib/apply-patch/preview";
import { shortenPath } from "@htwang-contrib/common";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines, INDENT, renderChangeBar, renderWithDelta, resolveIsSplit } from "./shared.ts";

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

export const applyPatchAdapter: ToolDisplayAdapter<ApplyPatchArgs> = {
  formatCallHeader(args, theme, _details?: unknown, _isPartial?: boolean, _expanded?: boolean) {
    const title = theme.fg("toolTitle", theme.bold("ApplyPatch"));
    const paths = patchedPaths(args?.input ?? "");
    if (paths.length === 0) {
      return `${title} ${theme.fg("toolOutput", "...")}`;
    }

    let header = `${title} ${theme.fg("accent", shortenPath(paths[0] ?? ""))}`;
    if (paths.length > 1) {
      header += ` ${theme.fg("toolOutput", `+${paths.length - 1} more`)}`;
    }
    return header;
  },

  formatCollapsedContent(args, _output, theme, width, details?: unknown, isPartial?: boolean) {
    const d = toDetails(details);
    const preview = d?.preview;
    const counts =
      preview !== undefined ? { added: preview.added, removed: preview.removed } : patchCounts(args?.input ?? "");
    const added = counts?.added ?? 0;
    const removed = counts?.removed ?? 0;
    const fileCount = preview?.files.length ?? patchedPaths(args?.input ?? "").length;

    const parts: string[] = ["└"];
    parts.push(theme.fg("muted", "patch"));
    if (isPartial && d?.progress) {
      parts.push(theme.fg("muted", `${d.progress.applied + d.progress.failed}/${d.progress.total}`));
    }
    if (added > 0) parts.push(theme.fg("success", `+${added}`));
    if (removed > 0) parts.push(theme.fg("error", `-${removed}`));
    if (counts !== null) {
      parts.push(theme.fg("muted", resolveIsSplit(width - INDENT.length * 2) ? "side-by-side" : "unified"));
    }
    if (fileCount > 1) {
      parts.push(theme.fg("muted", `· ${fileCount} files`));
    }
    if (d?.result && d.result.failures.length > 0) {
      parts.push(theme.fg("error", `✗ ${d.result.failures.length} failed`));
    }
    if (added > 0 || removed > 0) {
      parts.push(renderChangeBar(added, removed, theme));
    }
    return [theme.fg("muted", parts.join(" "))];
  },

  formatExpandedContent(args, _output, theme, width, details?: unknown) {
    const d = toDetails(details);
    const preview = d?.preview;

    if (!preview || preview.files.length === 0) {
      const input = args?.input ?? "";
      if (!input.trim()) return [];
      return formatExpandedToolOutputLines(input, theme, width);
    }

    const lines: string[] = [];
    if (preview.files.length === 1) {
      const file = preview.files[0];
      if (file) {
        if (file.diff) {
          lines.push(...renderWithDelta(file.diff, width, theme));
        } else {
          const target = file.movePath ? ` → ${shortenPath(file.movePath)}` : "";
          lines.push(INDENT + theme.fg("muted", `└ ${file.operation} ${shortenPath(file.filePath)}${target}`));
        }
      }
    } else {
      for (let i = 0; i < preview.files.length; i++) {
        const file = preview.files[i];
        if (!file) continue;
        const branch = i === preview.files.length - 1 ? "└" : "├";
        const header = `${INDENT}${theme.fg("muted", branch)} ${theme.fg("accent", formatPatchPath(file.filePath, file.movePath))}`;
        const stats: string[] = [];
        if (file.added > 0) stats.push(theme.fg("success", `+${file.added}`));
        if (file.removed > 0) stats.push(theme.fg("error", `-${file.removed}`));
        lines.push(stats.length > 0 ? `${header} ${stats.join(" ")}` : header);
        if (file.diff) {
          lines.push(...renderWithDelta(file.diff, width, theme));
        }
      }
    }

    for (const failure of d?.result?.failures ?? []) {
      const message = failure.message.split("\n")[0] ?? failure.message;
      lines.push(INDENT + theme.fg("error", `✗ ${failure.filePath} (${failure.operation}): ${message}`));
    }

    return lines;
  },
};
