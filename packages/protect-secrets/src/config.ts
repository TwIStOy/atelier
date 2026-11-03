import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";

export interface ProjectConfigResult {
  paths: string[];
  issues: string[];
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  result: ProjectConfigResult;
}

const cache = new Map<string, CacheEntry>();

export function getProjectConfigPath(projectRoot: string): string {
  return join(projectRoot, ".pi", "extensions", "protect-secrets", "config.json");
}

export function resetProjectConfigCache(): void {
  cache.clear();
}

interface ProjectConfigLocation {
  configPath: string;
  projectRoot: string;
}

/**
 * Walk up from `cwd` to find the nearest `.pi/extensions/protect-secrets/config.json`.
 * The directory containing `.pi` is the project root that relative
 * `protectedPaths` entries resolve against.
 */
function findProjectConfig(cwd: string): ProjectConfigLocation | null {
  let dir = resolve(cwd);
  for (;;) {
    const configPath = getProjectConfigPath(dir);
    if (existsSync(configPath)) return { configPath, projectRoot: dir };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadProjectConfig(cwd: string): ProjectConfigResult {
  const location = findProjectConfig(cwd);
  if (!location) return { paths: [], issues: [] };
  const stat = statSync(location.configPath);
  const cached = cache.get(location.configPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.result;
  const result = parseConfig(location.configPath, location.projectRoot);
  cache.set(location.configPath, { mtimeMs: stat.mtimeMs, size: stat.size, result });
  return result;
}

function readRawConfig(path: string): { raw: unknown; issue: string | null } {
  try {
    return { raw: JSON.parse(readFileSync(path, "utf-8")), issue: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { raw: undefined, issue: `Failed to parse config at '${path}': ${message}` };
  }
}

function configObjectIssue(parsed: unknown, path: string): string | null {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return `Config at '${path}' must be a JSON object`;
  }
  return null;
}

function parseEntries(raw: unknown[], path: string, projectRoot: string): ProjectConfigResult {
  const paths: string[] = [];
  const issues: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.trim() === "") {
      issues.push(`Config at '${path}': 'protectedPaths' entries must be non-empty strings`);
      continue;
    }
    paths.push(normalizePath(entry.trim(), projectRoot));
  }
  return { paths, issues };
}

function protectedPathsResult(raw: unknown, path: string, projectRoot: string): ProjectConfigResult {
  if (raw === undefined) return { paths: [], issues: [] };
  if (!Array.isArray(raw)) {
    return { paths: [], issues: [`Config at '${path}': 'protectedPaths' must be an array of strings`] };
  }
  return parseEntries(raw, path, projectRoot);
}

function parseConfig(path: string, projectRoot: string): ProjectConfigResult {
  const read = readRawConfig(path);
  if (read.issue) return { paths: [], issues: [read.issue] };
  const objectIssue = configObjectIssue(read.raw, path);
  if (objectIssue) return { paths: [], issues: [objectIssue] };
  const raw = (read.raw as Record<string, unknown>).protectedPaths;
  return protectedPathsResult(raw, path, projectRoot);
}

export function normalizePath(p: string, projectRoot: string): string {
  let expanded = p;
  if (expanded === "~" || expanded.startsWith("~/")) {
    expanded = join(homedir(), expanded.slice(1));
  }
  const absolute = isAbsolute(expanded) ? expanded : join(projectRoot, expanded);
  const normalized = normalize(absolute);
  return normalized === "/" ? normalized : normalized.replace(/\/+$/, "");
}
