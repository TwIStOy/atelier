import { diffLines } from "diff";

type DiffChange = { added?: boolean; removed?: boolean; value: string };

const CONTEXT = 3;

/**
 * With `newlineIsToken: true`, jsdiff emits terminating newlines as standalone
 * "\n" tokens after changed lines. Folding them into the preceding token keeps
 * line counts and context lines accurate (no phantom empty context line).
 */
function foldNewlineTokens(changes: DiffChange[]): DiffChange[] {
  const folded: DiffChange[] = [];
  for (const change of changes) {
    if (change.value === "\n" && folded.length > 0) {
      folded[folded.length - 1].value += "\n";
      continue;
    }
    folded.push({ ...change });
  }
  return folded;
}

type HunkState = {
  hunks: string[];
  oldLine: number;
  newLine: number;
  hunkOldStart: number;
  hunkOldCount: number;
  hunkNewStart: number;
  hunkNewCount: number;
  hunkBody: string[];
  inHunk: boolean;
};

function startHunk(state: HunkState, prev: DiffChange | undefined): void {
  let preContextCount = 0;
  if (prev && !prev.added && !prev.removed) {
    const lines = prev.value.replace(/\n$/, "").split("\n");
    preContextCount = Math.min(CONTEXT, lines.length);
    const start = lines.length - preContextCount;
    for (let j = start; j < lines.length; j++) {
      state.hunkBody.push(` ${lines[j]}`);
    }
  }

  state.hunkOldStart = state.oldLine - preContextCount;
  state.hunkNewStart = state.newLine - preContextCount;
  state.hunkOldCount = preContextCount;
  state.hunkNewCount = preContextCount;
  state.inHunk = true;
}

function flushHunk(state: HunkState): void {
  if (!state.inHunk || state.hunkBody.length === 0) return;
  state.hunks.push(`@@ -${state.hunkOldStart},${state.hunkOldCount} +${state.hunkNewStart},${state.hunkNewCount} @@`);
  state.hunks.push(...state.hunkBody);
  state.hunkBody = [];
  state.inHunk = false;
}

function applyContextChange(state: HunkState, textLines: string[]): void {
  if (!state.inHunk) {
    state.oldLine += textLines.length;
    state.newLine += textLines.length;
    return;
  }
  const postCtx = textLines.slice(0, CONTEXT);
  for (const line of postCtx) {
    state.hunkBody.push(` ${line}`);
    state.hunkOldCount++;
    state.hunkNewCount++;
  }
  const remaining = textLines.length - postCtx.length;
  state.oldLine += textLines.length;
  state.newLine += textLines.length;
  if (remaining > 0) {
    flushHunk(state);
  }
}

function applyChangedLines(
  state: HunkState,
  change: DiffChange,
  textLines: string[],
  prev: DiffChange | undefined,
): void {
  if (!state.inHunk) {
    startHunk(state, prev);
  }
  for (const line of textLines) {
    if (change.removed) {
      state.hunkBody.push(`-${line}`);
      state.hunkOldCount++;
      state.oldLine++;
    } else {
      state.hunkBody.push(`+${line}`);
      state.hunkNewCount++;
      state.newLine++;
    }
  }
}

function renderDiff(filePath: string, hunks: string[]): string {
  if (hunks.length === 0) return "";
  const header = `diff --git a/${filePath} b/${filePath}\n--- a/${filePath}\n+++ b/${filePath}`;
  return `${header}\n${hunks.join("\n")}\n`;
}

/**
 * Generate a unified diff (git-style header + @@ hunks with 3 context lines)
 * between two texts. Consumed by `delta` for terminal rendering.
 */
export function generateUnifiedDiff(filePath: string, oldText: string, newText: string): string {
  const changes = foldNewlineTokens(
    diffLines(oldText ?? "", newText ?? "", {
      newlineIsToken: true,
    }),
  );

  const state: HunkState = {
    hunks: [],
    oldLine: 1,
    newLine: 1,
    hunkOldStart: 0,
    hunkOldCount: 0,
    hunkNewStart: 0,
    hunkNewCount: 0,
    hunkBody: [],
    inHunk: false,
  };

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const textLines = change.value.replace(/\n$/, "").split("\n");
    if (!change.added && !change.removed) {
      applyContextChange(state, textLines);
    } else {
      applyChangedLines(state, change, textLines, changes[i - 1]);
    }
  }

  flushHunk(state);

  return renderDiff(filePath, state.hunks);
}
