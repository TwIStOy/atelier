import { constants, promises as fsPromises } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { formatDirectoryContext } from "./format.ts";
import { truncateBytes } from "./truncate.ts";
import {
  type AgentsSource,
  DEFAULT_FILE_NAMES,
  DEFAULT_MAX_BYTES_PER_FILE,
  DEFAULT_MAX_BYTES_PER_READ,
  type InjectedFileInfo,
  type InjectionFileError,
  type InjectionResult,
} from "./types.ts";

export interface InjectDirectoryContextInput {
  filePath: string;
  projectRoot: string;
  mirrorRoot: string | null;
  cache: {
    hasInjected(sessionKey: string, directory: string): boolean;
    markInjected(sessionKey: string, directory: string): void;
  };
  sessionKey: string;
  fileNames?: readonly string[];
  maxBytesPerFile?: number;
  maxBytesPerRead?: number;
}

const EMPTY_RESULT: InjectionResult = Object.freeze({
  injectedText: "",
  injectedFiles: [],
  errors: [],
});

interface ResolvedLimits {
  fileNames: readonly string[];
  maxBytesPerFile: number;
  maxBytesPerRead: number;
}

interface InjectionAccumulator {
  injectedFiles: InjectedFileInfo[];
  errors: InjectionFileError[];
  injectedText: string;
  budget: number;
}

export async function injectDirectoryContext(input: InjectDirectoryContextInput): Promise<InjectionResult> {
  const limits = resolveLimits(input);
  const contained = await resolveAndContain(input.filePath, input.projectRoot);
  if (!contained) return cloneEmpty();
  const candidates = await collectCandidates(input, contained, limits.fileNames);
  return injectCandidates(candidates, input, limits);
}

function resolveLimits(input: InjectDirectoryContextInput): ResolvedLimits {
  return {
    fileNames: input.fileNames ?? DEFAULT_FILE_NAMES,
    maxBytesPerFile: input.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE,
    maxBytesPerRead: input.maxBytesPerRead ?? DEFAULT_MAX_BYTES_PER_READ,
  };
}

async function collectCandidates(
  input: InjectDirectoryContextInput,
  contained: ContainedFile,
  fileNames: readonly string[],
): Promise<Candidate[]> {
  const projectCandidates = await findAgentsMdUp(contained.fileDir, contained.canonicalRoot, fileNames, "project");
  const mirrorCandidates = await collectMirrorCandidates(input, contained, fileNames);
  return [...projectCandidates, ...mirrorCandidates];
}

async function collectMirrorCandidates(
  input: InjectDirectoryContextInput,
  contained: ContainedFile,
  fileNames: readonly string[],
): Promise<Candidate[]> {
  if (!input.mirrorRoot) return [];
  const canonicalMirrorRoot = await realpathSafe(input.mirrorRoot);
  if (!canonicalMirrorRoot) return [];
  const rel = relative(contained.canonicalRoot, contained.canonicalPath);
  return findMirrorAgentsMdUp(canonicalMirrorRoot, contained.canonicalRoot, rel, fileNames);
}

async function injectCandidates(
  candidates: readonly Candidate[],
  input: InjectDirectoryContextInput,
  limits: ResolvedLimits,
): Promise<InjectionResult> {
  const acc: InjectionAccumulator = {
    injectedFiles: [],
    errors: [],
    injectedText: "",
    budget: limits.maxBytesPerRead,
  };
  for (const candidate of candidates) {
    if (acc.budget <= 0) break;
    await injectCandidate(candidate, input, limits.maxBytesPerFile, acc);
  }
  return { injectedText: acc.injectedText, injectedFiles: acc.injectedFiles, errors: acc.errors };
}

async function injectCandidate(
  candidate: Candidate,
  input: InjectDirectoryContextInput,
  maxBytesPerFile: number,
  acc: InjectionAccumulator,
): Promise<void> {
  if (input.cache.hasInjected(input.sessionKey, candidate.directory)) return;

  let content: string;
  try {
    content = await fsPromises.readFile(candidate.path, "utf-8");
  } catch (error) {
    acc.errors.push({ path: candidate.path, error: toInjectionError(error) });
    return;
  }

  const perFileCap = Math.min(maxBytesPerFile, acc.budget);
  const truncated = truncateBytes(content, perFileCap);

  acc.injectedFiles.push({
    absolutePath: candidate.path,
    directory: candidate.directory,
    source: candidate.source,
    truncated: truncated.truncated,
    originalBytes: truncated.originalBytes,
    injectedBytes: truncated.resultBytes,
  });

  acc.injectedText += formatDirectoryContext({
    directory: candidate.appliesTo,
    absolutePath: candidate.path,
    content: truncated.result,
    truncated: truncated.truncated,
  });

  input.cache.markInjected(input.sessionKey, candidate.directory);
  acc.budget -= truncated.resultBytes;
}

function toInjectionError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

interface Candidate {
  path: string;
  directory: string;
  appliesTo: string;
  source: AgentsSource;
}

interface ContainedFile {
  canonicalPath: string;
  canonicalRoot: string;
  fileDir: string;
}

async function resolveAndContain(filePath: string, rootDir: string): Promise<ContainedFile | null> {
  if (!filePath) return null;
  const resolvedPath = isAbsolute(filePath) ? filePath : resolve(rootDir, filePath);

  let canonicalRoot: string;
  let canonicalPath: string;
  try {
    canonicalRoot = await fsPromises.realpath(rootDir);
    canonicalPath = await fsPromises.realpath(resolvedPath);
  } catch {
    return null;
  }

  if (canonicalPath === canonicalRoot) return null;

  const rootBoundary = canonicalRoot.endsWith(sep) ? canonicalRoot : canonicalRoot + sep;
  if (!canonicalPath.startsWith(rootBoundary)) return null;

  return { canonicalPath, canonicalRoot, fileDir: dirname(canonicalPath) };
}

async function findAgentsMdUp(
  startDir: string,
  stopDir: string,
  fileNames: readonly string[],
  source: AgentsSource,
): Promise<Candidate[]> {
  const collected: Candidate[] = [];
  let current = startDir;

  while (true) {
    if (current === stopDir) break;
    const found = await firstExisting(current, fileNames);
    if (found) {
      collected.push({ path: found, directory: current, appliesTo: current, source });
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return collected.reverse();
}

async function findMirrorAgentsMdUp(
  canonicalMirrorRoot: string,
  canonicalRoot: string,
  rel: string,
  fileNames: readonly string[],
): Promise<Candidate[]> {
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return [];
  const parts = rel.split(sep);
  const collected: Candidate[] = [];
  for (let depth = 1; depth < parts.length; depth++) {
    const dirParts = parts.slice(0, depth);
    const dir = join(canonicalMirrorRoot, ...dirParts);
    const found = await firstExisting(dir, fileNames);
    if (found) {
      collected.push({ path: found, directory: dir, appliesTo: join(canonicalRoot, ...dirParts), source: "mirror" });
    }
  }
  return collected;
}

async function firstExisting(dir: string, fileNames: readonly string[]): Promise<string | null> {
  for (const name of fileNames) {
    const candidate = join(dir, name);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsPromises.access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function realpathSafe(p: string): Promise<string | null> {
  try {
    return await fsPromises.realpath(p);
  } catch {
    return null;
  }
}

function cloneEmpty(): InjectionResult {
  return { injectedText: EMPTY_RESULT.injectedText, injectedFiles: [], errors: [] };
}
