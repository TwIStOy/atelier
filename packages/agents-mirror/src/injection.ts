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

export async function injectDirectoryContext(input: InjectDirectoryContextInput): Promise<InjectionResult> {
  const fileNames = input.fileNames ?? DEFAULT_FILE_NAMES;
  const maxBytesPerFile = input.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE;
  const maxBytesPerRead = input.maxBytesPerRead ?? DEFAULT_MAX_BYTES_PER_READ;

  const contained = await resolveAndContain(input.filePath, input.projectRoot);
  if (!contained) return cloneEmpty();

  const projectCandidates = await findAgentsMdUp(contained.fileDir, contained.canonicalRoot, fileNames, "project");

  let mirrorCandidates: Candidate[] = [];
  if (input.mirrorRoot) {
    const canonicalMirrorRoot = await realpathSafe(input.mirrorRoot);
    if (canonicalMirrorRoot) {
      const rel = relative(contained.canonicalRoot, contained.canonicalPath);
      mirrorCandidates = await findMirrorAgentsMdUp(canonicalMirrorRoot, rel, fileNames);
    }
  }

  const allCandidates = [...projectCandidates, ...mirrorCandidates];

  const injectedFiles: InjectedFileInfo[] = [];
  const errors: InjectionFileError[] = [];
  let injectedText = "";
  let budget = maxBytesPerRead;

  for (const candidate of allCandidates) {
    if (input.cache.hasInjected(input.sessionKey, candidate.directory)) continue;
    if (budget <= 0) break;

    let content: string;
    try {
      content = await fsPromises.readFile(candidate.path, "utf-8");
    } catch (error) {
      errors.push({ path: candidate.path, error: error instanceof Error ? error : new Error(String(error)) });
      continue;
    }

    const perFileCap = Math.min(maxBytesPerFile, budget);
    const truncated = truncateBytes(content, perFileCap);

    injectedFiles.push({
      absolutePath: candidate.path,
      directory: candidate.directory,
      source: candidate.source,
      truncated: truncated.truncated,
      originalBytes: truncated.originalBytes,
      injectedBytes: truncated.resultBytes,
    });

    injectedText += formatDirectoryContext({
      absolutePath: candidate.path,
      content: truncated.result,
      truncated: truncated.truncated,
    });

    input.cache.markInjected(input.sessionKey, candidate.directory);
    budget -= truncated.resultBytes;
  }

  return { injectedText, injectedFiles, errors };
}

interface Candidate {
  path: string;
  directory: string;
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
      collected.push({ path: found, directory: current, source });
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return collected.reverse();
}

async function findMirrorAgentsMdUp(
  canonicalMirrorRoot: string,
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
      collected.push({ path: found, directory: dir, source: "mirror" });
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
