import { mkdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { type ParsedPatch, PatchApplicationError, parseNonEmptyPatch, replaceChunks } from "./patch.ts";

export type ApplyPatchOperation = "add" | "delete" | "update";

export type ApplyPatchFailure = {
  filePath: string;
  operation: ApplyPatchOperation;
  message: string;
  code?: string | undefined;
};

export type ApplyPatchRecoveryInstructions = {
  mustReadFiles: string[];
  mustNotReadFiles: string[];
  failedFiles: string[];
};

export type ApplyPatchResult = {
  summaries: string[];
  appliedFiles: string[];
  failures: ApplyPatchFailure[];
  hasPartialSuccess: boolean;
  recoveryInstructions: ApplyPatchRecoveryInstructions;
  details: {
    fuzz: number;
  };
};

export class ApplyPatchError extends Error {
  public readonly failures: ApplyPatchFailure[];
  public readonly result: ApplyPatchResult;

  constructor(message: string, result: ApplyPatchResult) {
    super(message);
    this.name = "ApplyPatchError";
    this.failures = result.failures;
    this.result = result;
  }
}

export type ApplyPatchProgress = {
  applied: number;
  failed: number;
  total: number;
};

export type ApplyPatchProgressCallback = (progress: ApplyPatchProgress) => Promise<void> | void;

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

type AtomicWriteOperations = {
  writeFile: (filePath: string, content: string, encoding: "utf-8") => Promise<void>;
  rename: (fromPath: string, toPath: string) => Promise<void>;
  unlink: (filePath: string) => Promise<void>;
};

const ATOMIC_WRITE_OPERATIONS: AtomicWriteOperations = {
  writeFile,
  rename,
  unlink,
};

export async function writeFileAtomic(
  absPath: string,
  content: string,
  operations: AtomicWriteOperations = ATOMIC_WRITE_OPERATIONS,
): Promise<void> {
  const tempPath = `${absPath}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
  await operations.writeFile(tempPath, content, "utf-8");
  try {
    await operations.rename(tempPath, absPath);
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) {
      throw error;
    }
    await operations.unlink(absPath);
    await operations.rename(tempPath, absPath);
  }
}

export function resolvePatchPath(cwd: string, filePath: string): string {
  return path.resolve(cwd, filePath);
}

async function canonicalMutationPath(filePath: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return path.resolve(filePath);
    }
    throw error;
  }
}

async function withPatchFileMutationQueues<T>(filePaths: string[], operation: () => Promise<T>): Promise<T> {
  const canonicalPaths = await Promise.all(filePaths.map(canonicalMutationPath));
  const sortedPaths = [...new Set(canonicalPaths)].sort((left, right) => left.localeCompare(right));

  const runQueued = (index: number): Promise<T> => {
    const filePath = sortedPaths[index];
    if (filePath === undefined) {
      return operation();
    }
    return withFileMutationQueue(filePath, () => runQueued(index + 1));
  };

  return runQueued(0);
}

async function applySingleHunk(
  cwd: string,
  hunk: ParsedPatch,
): Promise<{ summary: string; appliedFile: string; fuzz: number }> {
  const absolutePath = resolvePatchPath(cwd, hunk.filePath);
  const absoluteMovePath = hunk.type === "update" && hunk.movePath ? resolvePatchPath(cwd, hunk.movePath) : undefined;
  const mutationPaths = absoluteMovePath ? [absolutePath, absoluteMovePath] : [absolutePath];

  return withPatchFileMutationQueues(mutationPaths, async () => {
    if (hunk.type === "add") {
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFileAtomic(absolutePath, hunk.content);
      return { summary: `add: ${hunk.filePath}`, appliedFile: hunk.filePath, fuzz: 0 };
    }

    if (hunk.type === "delete") {
      await stat(absolutePath);
      await rm(absolutePath);
      return { summary: `delete: ${hunk.filePath}`, appliedFile: hunk.filePath, fuzz: 0 };
    }

    const currentContent = await readFile(absolutePath, "utf-8");
    const chunkResult =
      hunk.chunks.length === 0
        ? { content: currentContent, fuzz: 0 }
        : replaceChunks(currentContent, hunk.filePath, hunk.chunks);
    const nextContent = chunkResult.content;

    if (hunk.movePath && absoluteMovePath) {
      await mkdir(path.dirname(absoluteMovePath), { recursive: true });
      await writeFileAtomic(absoluteMovePath, nextContent);
      if (absoluteMovePath !== absolutePath) {
        await rm(absolutePath);
      }
      return {
        summary: `move: ${hunk.filePath} -> ${hunk.movePath}`,
        appliedFile: hunk.movePath,
        fuzz: chunkResult.fuzz,
      };
    }

    await writeFileAtomic(absolutePath, nextContent);
    return { summary: `update: ${hunk.filePath}`, appliedFile: hunk.filePath, fuzz: chunkResult.fuzz };
  });
}

function isRereadCandidate(failure: ApplyPatchFailure): boolean {
  // ENOENT (missing file), EACCES/EPERM (permission), ENOTDIR/EISDIR (path) are
  // not context mismatches — rereading will not fix them. Only context-line
  // failures (no code, thrown by replaceChunks) benefit from a reread.
  return failure.code === undefined;
}

function createRecoveryInstructions(
  result: Pick<ApplyPatchResult, "appliedFiles" | "failures">,
): ApplyPatchRecoveryInstructions {
  const mustReadFiles = [...new Set(result.failures.filter(isRereadCandidate).map((failure) => failure.filePath))];
  const mustReadFileSet = new Set(mustReadFiles);
  const failedFileSet = new Set(result.failures.map((failure) => failure.filePath));
  const mustNotReadFiles = [...new Set(result.appliedFiles.filter((filePath) => !mustReadFileSet.has(filePath)))];
  return { mustReadFiles, mustNotReadFiles, failedFiles: [...failedFileSet] };
}

function toFailure(hunk: ParsedPatch, error: unknown): ApplyPatchFailure {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
  return { filePath: hunk.filePath, operation: hunk.type, message, code };
}

export async function applyParsedPatchDetailed(
  cwd: string,
  hunks: ParsedPatch[],
  onProgress?: ApplyPatchProgressCallback,
): Promise<ApplyPatchResult> {
  const summaries: string[] = [];
  const appliedFiles: string[] = [];
  const failures: ApplyPatchFailure[] = [];
  let fuzz = 0;

  for (const hunk of hunks) {
    try {
      const { summary, appliedFile, fuzz: hunkFuzz } = await applySingleHunk(cwd, hunk);
      summaries.push(summary);
      appliedFiles.push(appliedFile);
      fuzz += hunkFuzz;
    } catch (error) {
      failures.push(toFailure(hunk, error));
    }
    if (onProgress) {
      try {
        await onProgress({ applied: appliedFiles.length, failed: failures.length, total: hunks.length });
      } catch {
        // Progress callbacks must not affect patch application.
      }
    }
  }

  const result: ApplyPatchResult = {
    summaries,
    appliedFiles,
    failures,
    hasPartialSuccess: appliedFiles.length > 0 && failures.length > 0,
    recoveryInstructions: { mustReadFiles: [], mustNotReadFiles: [], failedFiles: [] },
    details: { fuzz },
  };
  result.recoveryInstructions = createRecoveryInstructions(result);
  return result;
}

export async function applyPatchDetailed(
  cwd: string,
  patchText: string,
  onProgress?: ApplyPatchProgressCallback,
): Promise<ApplyPatchResult> {
  return applyParsedPatchDetailed(cwd, parseNonEmptyPatch(patchText), onProgress);
}

export async function applyPatch(cwd: string, patchText: string): Promise<string[]> {
  const hunks = parseNonEmptyPatch(patchText);

  const summaries: string[] = [];
  const appliedFiles: string[] = [];
  for (const hunk of hunks) {
    try {
      const { summary, appliedFile } = await applySingleHunk(cwd, hunk);
      summaries.push(summary);
      appliedFiles.push(appliedFile);
    } catch (error) {
      const failure = toFailure(hunk, error);
      const result: ApplyPatchResult = {
        summaries,
        appliedFiles,
        failures: [failure],
        hasPartialSuccess: appliedFiles.length > 0,
        recoveryInstructions: createRecoveryInstructions({
          appliedFiles,
          failures: [failure],
        }),
        details: { fuzz: 0 },
      };
      throw new ApplyPatchError(error instanceof Error ? error.message : String(error), result);
    }
  }

  return summaries;
}

export { PatchApplicationError };
