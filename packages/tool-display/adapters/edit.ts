import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { diffLines, type Change } from "diff";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { shortenPath } from "@htwang-contrib/common";
import type { ToolDisplayAdapter } from "../types.ts";
import { INDENT, replaceTabs } from "./shared.ts";

const SPLIT_MIN_WIDTH = 100;
const BAR_WIDTH = 6;
const MERGE_CONTEXT = 10;
const CONTEXT_LINES = 3;

interface EditArgs {
  path?: string;
  file_path?: string;
  edits?: Array<{ oldText: string; newText: string }>;
  oldText?: string;
  newText?: string;
}

interface ChangeBlock {
  changes: Change[];
  preContext: string[];
  postContext: string[];
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
    const changes = diffLines(edit.oldText, edit.newText, {
      newlineIsToken: true,
    });
    for (const change of changes) {
      if (change.added) added += change.count ?? 0;
      if (change.removed) removed += change.count ?? 0;
    }
  }
  return { added, removed };
}

function groupChangesIntoChunks(changes: Change[]): ChangeBlock[] {
  const changeIndices: number[] = [];
  for (let i = 0; i < changes.length; i++) {
    if (changes[i].added || changes[i].removed) {
      changeIndices.push(i);
    }
  }
  if (changeIndices.length === 0) return [];

  const groups: number[][] = [[changeIndices[0]]];
  for (let i = 1; i < changeIndices.length; i++) {
    const prev = changeIndices[i - 1];
    const curr = changeIndices[i];
    let gapLines = 0;
    for (let j = prev + 1; j < curr; j++) {
      if (!changes[j].added && !changes[j].removed) {
        gapLines += changes[j].count ?? 0;
      }
    }
    if (gapLines <= MERGE_CONTEXT) {
      groups[groups.length - 1].push(changeIndices[i]);
    } else {
      groups.push([changeIndices[i]]);
    }
  }

  return groups.map((group) => {
    const firstChangeIdx = group[0];
    const lastChangeIdx = group[group.length - 1];
    let changeStart = firstChangeIdx;
    let changeEnd = lastChangeIdx;
    while (changeEnd < changes.length - 1) {
      const next = changes[changeEnd + 1];
      if (!next.added && !next.removed) break;
      changeEnd++;
    }

    const blockChanges: Change[] = [];
    for (let i = changeStart; i <= changeEnd; i++) {
      blockChanges.push(changes[i]);
    }

    const preEq = firstChangeIdx > 0 ? changes[firstChangeIdx - 1] : null;
    const preLines =
      preEq && !preEq.added && !preEq.removed
        ? preEq.value.replace(/\n$/, "").split("\n")
        : [];
    const postEq =
      changeEnd < changes.length - 1 ? changes[changeEnd + 1] : null;
    const postLines =
      postEq && !postEq.added && !postEq.removed
        ? postEq.value.replace(/\n$/, "").split("\n")
        : [];

    return {
      changes: blockChanges,
      preContext: preLines.slice(-CONTEXT_LINES),
      postContext: postLines.slice(0, CONTEXT_LINES),
    };
  });
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
      oldContent =
        oldContent.slice(0, p.pos) +
        p.oldText +
        oldContent.slice(p.pos + p.newText.length);
    }

    return { oldFull: oldContent, newFull: newContent };
  } catch {
    return null;
  }
}

function findStartLine(
  filePath: string,
  newText: string,
  oldText: string,
): number {
  try {
    const content = readFileSync(resolve(filePath), "utf-8");
    let idx = content.indexOf(newText);
    if (idx === -1) idx = content.indexOf(oldText);
    if (idx === -1) return 1;
    return content.slice(0, idx).split("\n").length;
  } catch {
    return 1;
  }
}

function renderChangeBar(added: number, removed: number, theme: Theme): string {
  const total = added + removed;
  if (total === 0) return "";
  const removedW = Math.round((BAR_WIDTH * removed) / total);
  const addedW = BAR_WIDTH - removedW;
  return (
    "[" +
    theme.fg("error", "-".repeat(removedW)) +
    theme.fg("success", "-".repeat(addedW)) +
    "]"
  );
}

function formatDiffGutter(
  lineNum: number | null,
  maxNum: number,
  theme: Theme,
): string {
  const width = String(maxNum).length;
  if (lineNum === null) {
    return theme.fg("dim", " ".repeat(width) + " │ ");
  }
  return theme.fg("dim", String(lineNum).padStart(width) + " │ ");
}

function rawGutter(lineNum: number | null, maxNum: number): string {
  const width = String(maxNum).length;
  if (lineNum === null) {
    return " ".repeat(width) + " │ ";
  }
  return String(lineNum).padStart(width) + " │ ";
}

function gutterWidth(maxNum: number): number {
  return String(maxNum).length + 3;
}

function padRight(text: string, width: number): string {
  const vw = visibleWidth(text);
  if (vw >= width) return text;
  return text + " ".repeat(width - vw);
}

function computeMaxDisplayedLineNum(
  changes: Change[],
  chunks: ChangeBlock[],
  startLine: number,
): number {
  let oldLine = startLine;
  let newLine = startLine;
  let maxNum = 0;

  for (const chunk of chunks) {
    const firstIdx = changes.indexOf(chunk.changes[0]);
    if (firstIdx > 0) {
      const preEq = changes[firstIdx - 1];
      if (!preEq.added && !preEq.removed) {
        const allPre = preEq.value.replace(/\n$/, "").split("\n");
        oldLine += allPre.length - chunk.preContext.length;
        newLine += allPre.length - chunk.preContext.length;
      }
    }

    for (const ctxLine of chunk.preContext) {
      maxNum = Math.max(maxNum, oldLine, newLine);
      oldLine++;
      newLine++;
    }

    for (const change of chunk.changes) {
      const textLines = change.value.replace(/\n$/, "").split("\n");
      for (let i = 0; i < textLines.length; i++) {
        if (change.added) {
          maxNum = Math.max(maxNum, newLine);
          newLine++;
        } else if (change.removed) {
          maxNum = Math.max(maxNum, oldLine);
          oldLine++;
        } else {
          maxNum = Math.max(maxNum, oldLine, newLine);
          oldLine++;
          newLine++;
        }
      }
    }

    const lastChange = chunk.changes[chunk.changes.length - 1];
    const postEqIdx = changes.indexOf(lastChange) + 1;
    if (postEqIdx < changes.length) {
      const postEq = changes[postEqIdx];
      if (!postEq.added && !postEq.removed) {
        const allPost = postEq.value.replace(/\n$/, "").split("\n");
        const showCount = Math.min(chunk.postContext.length, allPost.length);
        for (let j = 0; j < showCount; j++) {
          maxNum = Math.max(maxNum, oldLine, newLine);
          oldLine++;
          newLine++;
        }
        oldLine += allPost.length - showCount;
        newLine += allPost.length - showCount;
      }
    }
  }

  return maxNum;
}

function renderUnifiedDiff(
  oldText: string,
  newText: string,
  theme: Theme,
  width: number,
  startLine: number,
): string[] {
  const changes = diffLines(oldText, newText, { newlineIsToken: true });
  const chunks = groupChangesIntoChunks(changes);
  if (chunks.length === 0) return [];

  const maxNum = computeMaxDisplayedLineNum(changes, chunks, startLine);
  const gw = gutterWidth(maxNum);
  const contentWidth = Math.max(1, width - INDENT.length - gw - 1);
  const lines: string[] = [];
  const sep = theme.fg("dim", "─".repeat(Math.max(1, width - INDENT.length)));

  let oldLine = startLine;
  let newLine = startLine;

  function skipEqualLines(count: number) {
    oldLine += count;
    newLine += count;
  }

  function renderContext(line: string) {
    const content = truncateToWidth(replaceTabs(line), contentWidth, "");
    lines.push(
      INDENT +
        formatDiffGutter(oldLine, maxNum, theme) +
        theme.fg("dim", " " + content),
    );
    oldLine++;
    newLine++;
  }

  function renderSep() {
    lines.push(INDENT + sep);
  }

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];

    if (ci > 0) renderSep();

    const preEqIdx = changes.indexOf(chunk.changes[0]) - 1;
    if (preEqIdx >= 0) {
      const preEq = changes[preEqIdx];
      const allPreLines = preEq.value.replace(/\n$/, "").split("\n");
      const skipCount = allPreLines.length - chunk.preContext.length;
      skipEqualLines(skipCount);
    }

    for (const ctxLine of chunk.preContext) {
      renderContext(ctxLine);
    }

    for (const change of chunk.changes) {
      const textLines = change.value.replace(/\n$/, "").split("\n");
      for (const line of textLines) {
        const content = truncateToWidth(replaceTabs(line), contentWidth, "");
        if (change.added) {
          const full = padRight(
            rawGutter(newLine, maxNum) + " " + content,
            width - INDENT.length,
          );
          lines.push(INDENT + theme.bg("toolSuccessBg", full));
          newLine++;
        } else if (change.removed) {
          const full = padRight(
            rawGutter(oldLine, maxNum) + " " + content,
            width - INDENT.length,
          );
          lines.push(INDENT + theme.bg("toolErrorBg", full));
          oldLine++;
        } else {
          renderContext(line);
        }
      }
    }

    const lastChange = chunk.changes[chunk.changes.length - 1];
    const postEqIdx = changes.indexOf(lastChange) + 1;
    if (postEqIdx < changes.length) {
      const postEq = changes[postEqIdx];
      const allPostLines = postEq.value.replace(/\n$/, "").split("\n");
      const showCount = Math.min(chunk.postContext.length, allPostLines.length);
      for (let j = 0; j < showCount; j++) {
        renderContext(allPostLines[j]);
      }
      skipEqualLines(allPostLines.length - showCount);
    }
  }

  return lines;
}

interface DiffRow {
  left: string;
  right: string;
  kind: "equal" | "changed" | "removed" | "added";
}

function renderSplitDiff(
  oldText: string,
  newText: string,
  theme: Theme,
  width: number,
  startLine: number,
): string[] {
  const changes = diffLines(oldText, newText, { newlineIsToken: true });
  const chunks = groupChangesIntoChunks(changes);
  if (chunks.length === 0) return [];

  const maxNum = computeMaxDisplayedLineNum(changes, chunks, startLine);
  const sep = theme.fg("dim", "│");
  const sepWidth = 1;
  const gw = gutterWidth(maxNum);
  const half = Math.floor((width - INDENT.length - sepWidth - gw * 2) / 2);
  const lw = Math.max(half, 1);
  const rw = Math.max(width - INDENT.length - sepWidth - gw * 2 - lw, 1);
  const lcw = Math.max(lw - gw, 1);
  const rcw = Math.max(rw - gw, 1);
  const hsep = theme.fg("dim", "─".repeat(Math.max(1, width - INDENT.length)));

  let oldLine = startLine;
  let newLine = startLine;
  const lines: string[] = [];

  function skipEqualLines(count: number) {
    oldLine += count;
    newLine += count;
  }

  function renderSplitRow(
    left: string,
    right: string,
    kind: "equal" | "changed" | "removed" | "added",
  ) {
    const leftNum = kind !== "added" ? oldLine : null;
    const rightNum = kind !== "removed" ? newLine : null;

    let leftStyled: string;
    let rightStyled: string;

    if (kind === "equal") {
      const content = truncateToWidth(replaceTabs(left), lcw, "");
      leftStyled = padRight(
        formatDiffGutter(leftNum, maxNum, theme) + " " + content,
        gw + lw,
      );
      rightStyled = padRight(
        formatDiffGutter(rightNum, maxNum, theme) +
          " " +
          truncateToWidth(replaceTabs(right), rcw, ""),
        gw + rw,
      );
    } else {
      if (kind !== "added") {
        const raw =
          rawGutter(leftNum, maxNum) +
          " " +
          truncateToWidth(replaceTabs(left), lcw - 1, "");
        leftStyled = theme.bg("toolErrorBg", padRight(raw, gw + lw));
      } else {
        leftStyled = theme.bg("toolErrorBg", " ".repeat(gw + lw));
      }
      if (kind !== "removed") {
        const raw =
          rawGutter(rightNum, maxNum) +
          " " +
          truncateToWidth(replaceTabs(right), rcw - 1, "");
        rightStyled = theme.bg("toolSuccessBg", padRight(raw, gw + rw));
      } else {
        rightStyled = theme.bg("toolSuccessBg", " ".repeat(gw + rw));
      }
    }

    lines.push(INDENT + leftStyled + sep + rightStyled);
    if (kind !== "added") oldLine++;
    if (kind !== "removed") newLine++;
  }

  function renderSep() {
    lines.push(INDENT + hsep);
  }

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];

    if (ci > 0) renderSep();

    const preEqIdx = changes.indexOf(chunk.changes[0]) - 1;
    if (preEqIdx >= 0) {
      const preEq = changes[preEqIdx];
      const allPreLines = preEq.value.replace(/\n$/, "").split("\n");
      const skipCount = allPreLines.length - chunk.preContext.length;
      skipEqualLines(skipCount);
    }

    for (const ctxLine of chunk.preContext) {
      renderSplitRow(ctxLine, ctxLine, "equal");
    }

    const blockChanges: Change[] = [];
    for (const change of chunk.changes) {
      if (!change.added && !change.removed) {
        for (const line of change.value.replace(/\n$/, "").split("\n")) {
          renderSplitRow(line, line, "equal");
        }
      } else {
        blockChanges.push(change);
      }
    }
    const rows = buildDiffRowsFromChanges(blockChanges);
    for (const row of rows) {
      renderSplitRow(row.left, row.right, row.kind);
    }

    const lastChange = chunk.changes[chunk.changes.length - 1];
    const postEqIdx = changes.indexOf(lastChange) + 1;
    if (postEqIdx < changes.length) {
      const postEq = changes[postEqIdx];
      const allPostLines = postEq.value.replace(/\n$/, "").split("\n");
      const showCount = Math.min(chunk.postContext.length, allPostLines.length);
      for (let j = 0; j < showCount; j++) {
        renderSplitRow(allPostLines[j], allPostLines[j], "equal");
      }
      skipEqualLines(allPostLines.length - showCount);
    }
  }

  return lines;
}

function buildDiffRowsFromChanges(changes: Change[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0;

  while (i < changes.length) {
    const change = changes[i];
    if (!change.added && !change.removed) {
      for (const line of change.value.replace(/\n$/, "").split("\n")) {
        rows.push({ left: line, right: line, kind: "equal" });
      }
      i++;
    } else if (change.removed) {
      const oldLines = change.value.replace(/\n$/, "").split("\n");
      let newLines: string[] = [];
      if (i + 1 < changes.length && changes[i + 1].added) {
        newLines = changes[i + 1].value.replace(/\n$/, "").split("\n");
        i += 2;
      } else {
        i++;
      }
      const maxLen = Math.max(oldLines.length, newLines.length);
      for (let j = 0; j < maxLen; j++) {
        const o = j < oldLines.length ? oldLines[j] : "";
        const n = j < newLines.length ? newLines[j] : "";
        if (o && !n) rows.push({ left: o, right: "", kind: "removed" });
        else if (!o && n) rows.push({ left: "", right: n, kind: "added" });
        else rows.push({ left: o, right: n, kind: "changed" });
      }
    } else {
      for (const line of change.value.replace(/\n$/, "").split("\n")) {
        rows.push({ left: "", right: line, kind: "added" });
      }
      i++;
    }
  }

  return rows;
}

function renderEditDiff(
  oldText: string,
  newText: string,
  theme: Theme,
  width: number,
  startLine: number,
): string[] {
  if (width >= SPLIT_MIN_WIDTH) {
    return renderSplitDiff(oldText, newText, theme, width, startLine);
  }
  return renderUnifiedDiff(oldText, newText, theme, width, startLine);
}

export const editAdapter: ToolDisplayAdapter<EditArgs> = {
  formatCallHeader(args, theme) {
    const rawPath = args?.file_path ?? args?.path ?? "";
    const path = shortenPath(rawPath);
    const pathDisplay = path
      ? theme.fg("accent", path)
      : theme.fg("toolOutput", "...");
    return theme.fg("toolTitle", theme.bold("Edit")) + " " + pathDisplay;
  },

  formatCollapsedContent(args, _output, theme, width) {
    const edits = getEdits(args);
    if (edits.length === 0) return [theme.fg("muted", "└ no changes")];

    const { added, removed } = countChanges(edits);
    const parts: string[] = ["└"];
    parts.push(theme.fg("muted", "diff"));
    if (added > 0) parts.push(theme.fg("success", `+${added}`));
    if (removed > 0) parts.push(theme.fg("error", `-${removed}`));
    parts.push(
      theme.fg("muted", width >= SPLIT_MIN_WIDTH ? "split" : "unified"),
    );
    if (added > 0 || removed > 0) {
      parts.push(renderChangeBar(added, removed, theme));
    }
    return [theme.fg("muted", parts.join(" "))];
  },

  formatExpandedContent(args, _output, theme, width) {
    const edits = getEdits(args);
    if (edits.length === 0) return [];

    const rawPath = args?.file_path ?? args?.path ?? "";

    if (edits.length > 1) {
      const fullDiff = buildFullFileDiff(rawPath, edits);
      if (fullDiff) {
        return renderEditDiff(
          fullDiff.oldFull,
          fullDiff.newFull,
          theme,
          width,
          1,
        );
      }
    }

    const lines: string[] = [];
    for (let i = 0; i < edits.length; i++) {
      if (edits.length > 1 && i > 0) {
        lines.push(
          INDENT +
            theme.fg("dim", "─".repeat(Math.max(1, width - INDENT.length))),
        );
      }

      const startLine = findStartLine(
        rawPath,
        edits[i].newText,
        edits[i].oldText,
      );
      lines.push(
        ...renderEditDiff(
          edits[i].oldText,
          edits[i].newText,
          theme,
          width,
          startLine,
        ),
      );
    }

    return lines;
  },
};
