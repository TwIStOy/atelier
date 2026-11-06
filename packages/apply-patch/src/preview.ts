import { readFile } from "node:fs/promises";
import { generateUnifiedDiff } from "@htwang-contrib/common/diff";
import { type Change, diffLines } from "diff";
import { type ApplyPatchOperation, type ApplyPatchProgress, type ApplyPatchResult, resolvePatchPath } from "./apply.ts";
import { type ParsedPatch, replaceChunks } from "./patch.ts";

export type ApplyPatchPreviewFile = {
  filePath: string;
  movePath?: string;
  operation: ApplyPatchOperation;
  diff: string;
  added: number;
  removed: number;
};

export type ApplyPatchPreview = {
  files: ApplyPatchPreviewFile[];
  added: number;
  removed: number;
};

export type ApplyPatchToolDetails = {
  preview?: ApplyPatchPreview;
  progress?: ApplyPatchProgress;
  result?: ApplyPatchResult;
};

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

async function readExistingFileForPreview(absolutePath: string): Promise<string> {
  try {
    return await readFile(absolutePath, "utf-8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return "";
    }
    throw error;
  }
}

function countDiffChanges(changes: Change[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const change of changes) {
    if (change.added) added += change.count ?? 0;
    if (change.removed) removed += change.count ?? 0;
  }
  return { added, removed };
}

function diffPreviewFile(
  filePath: string,
  operation: ApplyPatchOperation,
  oldContent: string,
  newContent: string,
  movePath?: string,
): ApplyPatchPreviewFile {
  const diff = generateUnifiedDiff(filePath, oldContent, newContent);
  const { added, removed } = countDiffChanges(diffLines(oldContent, newContent));
  const file: ApplyPatchPreviewFile = { filePath, operation, diff, added, removed };
  return movePath !== undefined ? { ...file, movePath } : file;
}

/**
 * Build a per-file preview for a parsed patch by reading the current on-disk
 * content and applying update chunks in memory. Must run before the patch is
 * applied; afterwards the on-disk content no longer reflects the old state.
 */
export async function createPatchPreview(cwd: string, hunks: ParsedPatch[]): Promise<ApplyPatchPreview> {
  const files: ApplyPatchPreviewFile[] = [];
  for (const hunk of hunks) {
    const absolutePath = resolvePatchPath(cwd, hunk.filePath);
    if (hunk.type === "add") {
      const oldContent = await readExistingFileForPreview(absolutePath);
      files.push(diffPreviewFile(hunk.filePath, oldContent.length > 0 ? "update" : "add", oldContent, hunk.content));
      continue;
    }

    if (hunk.type === "delete") {
      const oldContent = await readFile(absolutePath, "utf-8");
      files.push(diffPreviewFile(hunk.filePath, "delete", oldContent, ""));
      continue;
    }

    const oldContent = await readFile(absolutePath, "utf-8");
    const newContent =
      hunk.chunks.length === 0 ? oldContent : replaceChunks(oldContent, hunk.filePath, hunk.chunks).content;
    if (hunk.movePath) {
      await resolvePatchPath(cwd, hunk.movePath);
    }
    files.push(diffPreviewFile(hunk.filePath, "update", oldContent, newContent, hunk.movePath));
  }

  return {
    files,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
  };
}
