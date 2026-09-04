import { diffLines } from "diff";

/**
 * With `newlineIsToken: true`, jsdiff emits terminating newlines as standalone
 * "\n" tokens after changed lines. Folding them into the preceding token keeps
 * line counts and context lines accurate (no phantom empty context line).
 */
function foldNewlineTokens(changes: { added?: boolean; removed?: boolean; value: string }[]): {
  added?: boolean;
  removed?: boolean;
  value: string;
}[] {
  const folded: { added?: boolean; removed?: boolean; value: string }[] = [];
  for (const change of changes) {
    if (change.value === "\n" && folded.length > 0) {
      folded[folded.length - 1].value += "\n";
      continue;
    }
    folded.push({ ...change });
  }
  return folded;
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
