import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { generateUnifiedDiff } from "@htwang-contrib/common/diff";
import { diffLines } from "diff";
import { loadConfig } from "../config.ts";
import type { ToolDisplayAdapter } from "../types.ts";
import { filePathDisplay, rawPathOf, renderChangeBar, renderWithDelta, resolveIsSplit } from "./shared.ts";

interface EditArgs {
  path?: string;
  file_path?: string;
  edits?: Array<{ oldText: string; newText: string }>;
  oldText?: string;
  newText?: string;
}

function getEdits(args: EditArgs): Array<{ oldText: string; newText: string }> {
  if (args.edits && args.edits.length > 0) return args.edits;
  if (args.oldText !== undefined && args.newText !== undefined) {
    return [{ oldText: args.oldText, newText: args.newText }];
  }
  return [];
}

function countChanges(edits: Array<{ oldText: string; newText: string }>): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const edit of edits) {
    const changes = diffLines(edit.oldText ?? "", edit.newText ?? "", {
      newlineIsToken: true,
    });
    for (const change of changes) {
      if (change.added) added += change.count ?? 0;
      if (change.removed) removed += change.count ?? 0;
    }
  }
  return { added, removed };
}

function editPositions(
  newContent: string,
  edits: Array<{ oldText: string; newText: string }>,
): Array<{ oldText: string; newText: string; pos: number }> {
  const positions: Array<{ oldText: string; newText: string; pos: number }> = [];
  for (const edit of edits) {
    const pos = newContent.indexOf(edit.newText);
    if (pos === -1) continue;
    positions.push({ ...edit, pos });
  }
  return positions;
}

function buildFullFileDiff(
  filePath: string,
  edits: Array<{ oldText: string; newText: string }>,
): { oldFull: string; newFull: string } | null {
  try {
    const newContent = readFileSync(resolve(filePath), "utf-8");
    let oldContent = newContent;

    const positions = editPositions(newContent, edits);
    positions.sort((a, b) => b.pos - a.pos);
    for (const p of positions) {
      oldContent = oldContent.slice(0, p.pos) + p.oldText + oldContent.slice(p.pos + p.newText.length);
    }

    return { oldFull: oldContent, newFull: newContent };
  } catch {
    return null;
  }
}

function buildDiffStatsSuffix(args: EditArgs, theme: Theme, width: number | undefined): string {
  const edits = getEdits(args);
  if (edits.length === 0) return "";

  const { added, removed } = countChanges(edits);
  const parts: string[] = [];
  if (added > 0) parts.push(theme.fg("success", `+${added}`));
  if (removed > 0) parts.push(theme.fg("error", `-${removed}`));
  if (width !== undefined) {
    parts.push(theme.fg("muted", resolveIsSplit(width) ? "side-by-side" : "unified"));
  }
  if (added > 0 || removed > 0) {
    parts.push(renderChangeBar(added, removed, theme));
  }
  return parts.length > 0 ? parts.join(" ") : "";
}

function allEditDiffs(rawPath: string, edits: Array<{ oldText: string; newText: string }>): string[] {
  const allDiff: string[] = [];
  for (let i = 0; i < edits.length; i++) {
    const unified = generateUnifiedDiff(rawPath, edits[i].oldText, edits[i].newText);
    if (unified) allDiff.push(unified);
  }
  return allDiff;
}

export const editAdapter: ToolDisplayAdapter<EditArgs> = {
  formatCallHeader(args, theme, _details?: unknown, isPartial?: boolean, _expanded?: boolean, width?: number) {
    const verb = isPartial ? "Editing" : "Edited";
    const base = `${theme.fg("toolTitle", theme.bold(verb))} ${filePathDisplay(args, theme)}`;

    if (loadConfig().editStyle !== "single-line") return base;

    const suffix = buildDiffStatsSuffix(args ?? {}, theme, width);
    if (!suffix) return base;
    if (width !== undefined && visibleWidth(base) + 1 + visibleWidth(suffix) > width) return base;
    return `${base} ${suffix}`;
  },

  formatCollapsedContent(args, _output, theme, width, _details?: unknown, _isPartial?: boolean, _spinAt?: number) {
    if (loadConfig().editStyle === "single-line") return [];

    const edits = getEdits(args);
    if (edits.length === 0) return [theme.fg("muted", "└ no changes")];

    const { added, removed } = countChanges(edits);
    const parts: string[] = ["└"];
    parts.push(theme.fg("muted", "diff"));
    if (added > 0) parts.push(theme.fg("success", `+${added}`));
    if (removed > 0) parts.push(theme.fg("error", `-${removed}`));
    parts.push(theme.fg("muted", resolveIsSplit(width) ? "side-by-side" : "unified"));
    if (added > 0 || removed > 0) {
      parts.push(renderChangeBar(added, removed, theme));
    }
    return [theme.fg("muted", parts.join(" "))];
  },

  formatExpandedContent(args, _output, _theme, width, _details?: unknown) {
    const edits = getEdits(args);
    if (edits.length === 0) return [];

    const rawPath = rawPathOf(args);

    if (edits.length > 1) {
      const fullDiff = buildFullFileDiff(rawPath, edits);
      if (fullDiff) {
        const unified = generateUnifiedDiff(rawPath, fullDiff.oldFull, fullDiff.newFull);
        if (unified) return renderWithDelta(unified, width, _theme);
      }
    }

    const allDiff = allEditDiffs(rawPath, edits);
    if (allDiff.length === 0) return [];
    return renderWithDelta(allDiff.join("\n"), width, _theme);
  },
};
