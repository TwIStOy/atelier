import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { diffLines } from "diff";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { shortenPath } from "@htwang-contrib/common";
import type { ToolDisplayAdapter } from "../types.ts";
import { INDENT, replaceTabs } from "./shared.ts";

const SPLIT_MIN_WIDTH = 100;
const BAR_WIDTH = 6;

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

function renderUnifiedDiff(
  oldText: string,
  newText: string,
  theme: Theme,
  width: number,
  startLine: number,
): string[] {
  const changes = diffLines(oldText, newText, { newlineIsToken: true });
  const maxOld = startLine + oldText.split("\n").length - 1;
  const maxNew = startLine + newText.split("\n").length - 1;
  const maxNum = Math.max(maxOld, maxNew);
  const gw = gutterWidth(maxNum);
  const contentWidth = Math.max(1, width - INDENT.length - gw - 2);
  const lines: string[] = [];

  let oldLine = startLine;
  let newLine = startLine;

  for (const change of changes) {
    const textLines = change.value.replace(/\n$/, "").split("\n");
    for (const line of textLines) {
      const content = truncateToWidth(replaceTabs(line), contentWidth, "");
      if (change.added) {
        const full = padRight(
          rawGutter(newLine, maxNum) + "+ " + content,
          width - INDENT.length,
        );
        lines.push(INDENT + theme.bg("toolSuccessBg", full));
        newLine++;
      } else if (change.removed) {
        const full = padRight(
          rawGutter(oldLine, maxNum) + "- " + content,
          width - INDENT.length,
        );
        lines.push(INDENT + theme.bg("toolErrorBg", full));
        oldLine++;
      } else {
        lines.push(
          INDENT +
            formatDiffGutter(oldLine, maxNum, theme) +
            theme.fg("dim", "  " + content),
        );
        oldLine++;
        newLine++;
      }
    }
  }

  return lines;
}

interface DiffRow {
  left: string;
  right: string;
  kind: "equal" | "changed" | "removed" | "added";
}

function buildDiffRows(oldText: string, newText: string): DiffRow[] {
  const changes = diffLines(oldText, newText, { newlineIsToken: true });
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

function renderSplitDiff(
  oldText: string,
  newText: string,
  theme: Theme,
  width: number,
  startLine: number,
): string[] {
  const rows = buildDiffRows(oldText, newText);
  const oldLineCount = oldText.split("\n").length;
  const newLineCount = newText.split("\n").length;
  const maxOld = startLine + oldLineCount - 1;
  const maxNew = startLine + newLineCount - 1;
  const sep = theme.fg("dim", "│");
  const sepWidth = 1;
  const lgw = gutterWidth(maxOld);
  const rgw = gutterWidth(maxNew);
  const half = Math.floor((width - INDENT.length - sepWidth - lgw - rgw) / 2);
  const lw = Math.max(half, 1);
  const rw = Math.max(width - INDENT.length - sepWidth - lgw - rgw - lw, 1);
  const lcw = Math.max(lw - lgw, 1);
  const rcw = Math.max(rw - rgw, 1);

  let oldLine = startLine;
  let newLine = startLine;
  const lines: string[] = [];

  for (const row of rows) {
    const leftNum = row.left ? oldLine : null;
    const rightNum = row.right ? newLine : null;

    let leftStyled: string;
    let rightStyled: string;

    if (row.kind === "equal") {
      const content = truncateToWidth(replaceTabs(row.left), lcw, "");
      leftStyled = padRight(
        formatDiffGutter(leftNum, maxOld, theme) + " " + content,
        lgw + lw,
      );
      rightStyled =
        formatDiffGutter(rightNum, maxNew, theme) +
        " " +
        truncateToWidth(replaceTabs(row.right), rcw, "");
    } else {
      if (row.left) {
        const raw =
          rawGutter(leftNum, maxOld) +
          "- " +
          truncateToWidth(replaceTabs(row.left), lcw - 2, "");
        leftStyled = theme.bg("toolErrorBg", padRight(raw, lgw + lw));
      } else {
        leftStyled = theme.bg("toolErrorBg", " ".repeat(lgw + lw));
      }
      if (row.right) {
        const raw =
          rawGutter(rightNum, maxNew) +
          "+ " +
          truncateToWidth(replaceTabs(row.right), rcw - 2, "");
        rightStyled = theme.bg("toolSuccessBg", padRight(raw, rgw + rw));
      } else {
        rightStyled = theme.bg("toolSuccessBg", " ".repeat(rgw + rw));
      }
    }

    lines.push(INDENT + leftStyled + sep + rightStyled);

    if (row.left) oldLine++;
    if (row.right) newLine++;
  }

  return lines;
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
    parts.push(theme.fg("muted", width >= SPLIT_MIN_WIDTH ? "split" : "unified"));
    if (added > 0 || removed > 0) {
      parts.push(renderChangeBar(added, removed, theme));
    }
    return [theme.fg("muted", parts.join(" "))];
  },

  formatExpandedContent(args, _output, theme, width) {
    const edits = getEdits(args);
    if (edits.length === 0) return [];

    const rawPath = args?.file_path ?? args?.path ?? "";
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
