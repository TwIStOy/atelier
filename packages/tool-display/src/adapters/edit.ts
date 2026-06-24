import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { extractAnsiRgb, shortenPath } from "@htwang-contrib/common";
import { diffLines } from "diff";
import { loadConfig } from "../config.ts";
import type { ToolDisplayAdapter } from "../types.ts";
import { INDENT, replaceTabs } from "./shared.ts";

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

function buildFullFileDiff(
  filePath: string,
  edits: Array<{ oldText: string; newText: string }>,
): { oldFull: string; newFull: string } | null {
  try {
    const newContent = readFileSync(resolve(filePath), "utf-8");
    let oldContent = newContent;

    const positions: Array<{
      oldText: string;
      newText: string;
      pos: number;
    }> = [];
    for (const edit of edits) {
      const pos = newContent.indexOf(edit.newText);
      if (pos === -1) continue;
      positions.push({ ...edit, pos });
    }

    positions.sort((a, b) => b.pos - a.pos);
    for (const p of positions) {
      oldContent = oldContent.slice(0, p.pos) + p.oldText + oldContent.slice(p.pos + p.newText.length);
    }

    return { oldFull: oldContent, newFull: newContent };
  } catch {
    return null;
  }
}

function generateUnifiedDiff(filePath: string, oldText: string, newText: string): string {
  const changes = diffLines(oldText ?? "", newText ?? "", {
    newlineIsToken: true,
  });

  let oldLine = 1;
  let newLine = 1;
  const hunks: string[] = [];

  let hunkOldStart = 0;
  let hunkOldCount = 0;
  let hunkNewStart = 0;
  let hunkNewCount = 0;
  let hunkBody: string[] = [];
  let inHunk = false;

  const CONTEXT = 3;

  function startHunk(changeIdx: number) {
    let preContextCount = 0;
    if (changeIdx > 0) {
      const prev = changes[changeIdx - 1];
      if (!prev.added && !prev.removed) {
        const lines = prev.value.replace(/\n$/, "").split("\n");
        preContextCount = Math.min(CONTEXT, lines.length);
        const start = lines.length - preContextCount;
        for (let j = start; j < lines.length; j++) {
          hunkBody.push(` ${lines[j]}`);
        }
      }
    }

    hunkOldStart = oldLine - preContextCount;
    hunkNewStart = newLine - preContextCount;
    hunkOldCount = preContextCount;
    hunkNewCount = preContextCount;
    inHunk = true;
  }

  function flushHunk() {
    if (!inHunk || hunkBody.length === 0) return;
    hunks.push(`@@ -${hunkOldStart},${hunkOldCount} +${hunkNewStart},${hunkNewCount} @@`);
    hunks.push(...hunkBody);
    hunkBody = [];
    inHunk = false;
  }

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const textLines = change.value.replace(/\n$/, "").split("\n");

    if (!change.added && !change.removed) {
      if (inHunk) {
        const postCtx = textLines.slice(0, CONTEXT);
        for (const line of postCtx) {
          hunkBody.push(` ${line}`);
          hunkOldCount++;
          hunkNewCount++;
        }

        const remaining = textLines.length - postCtx.length;
        oldLine += textLines.length;
        newLine += textLines.length;

        if (remaining > 0) {
          flushHunk();
        }
      } else {
        oldLine += textLines.length;
        newLine += textLines.length;
      }
    } else {
      if (!inHunk) {
        startHunk(i);
      }

      for (const line of textLines) {
        if (change.removed) {
          hunkBody.push(`-${line}`);
          hunkOldCount++;
          oldLine++;
        } else {
          hunkBody.push(`+${line}`);
          hunkNewCount++;
          newLine++;
        }
      }
    }
  }

  flushHunk();

  if (hunks.length === 0) return "";

  const header = `diff --git a/${filePath} b/${filePath}\n--- a/${filePath}\n+++ b/${filePath}`;
  return `${header}\n${hunks.join("\n")}\n`;
}

function resolveIsSplit(innerWidth: number): boolean {
  const cfg = loadConfig();
  if (cfg.diffMode === "side-by-side") return true;
  if (cfg.diffMode === "unified") return false;
  return innerWidth >= cfg.splitDiffMinWidth;
}

function renderWithDelta(unifiedDiff: string, width: number, theme: Theme): string[] {
  const innerWidth = Math.max(1, width - INDENT.length);
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
      .map((line) => INDENT + truncateToWidth(replaceTabs(line), width, ""));
  } catch {
    return unifiedDiff
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => INDENT + line);
  }
}

function renderChangeBar(added: number, removed: number, theme: Theme): string {
  const total = added + removed;
  if (total === 0) return "";
  const removedW = Math.round((BAR_WIDTH * removed) / total);
  const addedW = BAR_WIDTH - removedW;
  return `[${theme.fg("error", "-".repeat(removedW))}${theme.fg("success", "-".repeat(addedW))}]`;
}

export const editAdapter: ToolDisplayAdapter<EditArgs> = {
  formatCallHeader(args, theme, _details?: unknown, _isPartial?: boolean, _expanded?: boolean) {
    const rawPath = args?.file_path ?? args?.path ?? "";
    const path = shortenPath(rawPath);
    const pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
    return `${theme.fg("toolTitle", theme.bold("Edit"))} ${pathDisplay}`;
  },

  formatCollapsedContent(args, _output, theme, width, _details?: unknown, _isPartial?: boolean, _spinAt?: number) {
    const edits = getEdits(args);
    if (edits.length === 0) return [theme.fg("muted", "└ no changes")];

    const { added, removed } = countChanges(edits);
    const parts: string[] = ["└"];
    parts.push(theme.fg("muted", "diff"));
    if (added > 0) parts.push(theme.fg("success", `+${added}`));
    if (removed > 0) parts.push(theme.fg("error", `-${removed}`));
    parts.push(theme.fg("muted", resolveIsSplit(width - INDENT.length * 2) ? "side-by-side" : "unified"));
    if (added > 0 || removed > 0) {
      parts.push(renderChangeBar(added, removed, theme));
    }
    return [theme.fg("muted", parts.join(" "))];
  },

  formatExpandedContent(args, _output, _theme, width, _details?: unknown) {
    const edits = getEdits(args);
    if (edits.length === 0) return [];

    const rawPath = args?.file_path ?? args?.path ?? "";

    if (edits.length > 1) {
      const fullDiff = buildFullFileDiff(rawPath, edits);
      if (fullDiff) {
        const unified = generateUnifiedDiff(rawPath, fullDiff.oldFull, fullDiff.newFull);
        if (unified) return renderWithDelta(unified, width, _theme);
      }
    }

    const allDiff: string[] = [];
    for (let i = 0; i < edits.length; i++) {
      const unified = generateUnifiedDiff(rawPath, edits[i].oldText, edits[i].newText);
      if (unified) allDiff.push(unified);
    }

    if (allDiff.length === 0) return [];
    return renderWithDelta(allDiff.join("\n"), width, _theme);
  },
};
