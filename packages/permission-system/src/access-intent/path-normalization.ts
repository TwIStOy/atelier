import { posix as posixPath, win32 as winPath } from "node:path";

import { canonicalizePath } from "../canonicalize-path.ts";
import { expandHomePath } from "../expand-home.ts";
import { isPathWithinDirectory } from "../path-containment.ts";

export function normalizePathForComparison(pathValue: string, cwd: string, platform: NodeJS.Platform): string {
  const trimmed = pathValue.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) {
    return "";
  }

  let normalizedPath = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  normalizedPath = expandHomePath(normalizedPath);

  const impl = platform === "win32" ? winPath : posixPath;
  const absolutePath = impl.resolve(cwd, normalizedPath);
  const normalizedAbsolutePath = impl.normalize(absolutePath);
  return platform === "win32" ? normalizedAbsolutePath.toLowerCase() : normalizedAbsolutePath;
}

export interface PathPolicyValueOptions {
  cwd?: string;
  resolveBase?: string;
}

export function normalizePathPolicyLiteral(pathValue: string): string {
  const trimmed = pathValue.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return "";
  const unprefixed = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return expandHomePath(unprefixed);
}

export function getPathPolicyValues(
  pathValue: string,
  options: PathPolicyValueOptions,
  platform: NodeJS.Platform,
): string[] {
  const literal = normalizePathPolicyLiteral(pathValue);
  if (!literal) return [];
  if (literal === "*") return ["*"];

  return [...new Set([...getAbsolutePathPolicyValues(pathValue, options, platform), literal])];
}

function getAbsolutePathPolicyValues(
  pathValue: string,
  options: PathPolicyValueOptions,
  platform: NodeJS.Platform,
): string[] {
  const resolveBase = options.resolveBase ?? options.cwd;
  if (!resolveBase) return [];

  const absolute = normalizePathForComparison(pathValue, resolveBase, platform);
  if (!absolute) return [];

  return [absolute, ...getCwdRelativePathPolicyValues(absolute, options.cwd, platform)];
}

function getCwdRelativePathPolicyValues(
  absolute: string,
  cwd: string | undefined,
  platform: NodeJS.Platform,
): string[] {
  if (!cwd) return [];

  const normalizedCwd = normalizePathForComparison(cwd, cwd, platform);
  if (!normalizedCwd) return [];
  if (absolute !== normalizedCwd && !isPathWithinDirectory(absolute, normalizedCwd, platform)) {
    return [];
  }

  const impl = platform === "win32" ? winPath : posixPath;
  const relativeValue = impl.relative(normalizedCwd, absolute);
  return relativeValue ? [relativeValue] : [];
}

export function canonicalNormalizePathForComparison(pathValue: string, cwd: string, platform: NodeJS.Platform): string {
  const lexical = normalizePathForComparison(pathValue, cwd, platform);
  if (!lexical) return "";
  const canonical = canonicalizePath(lexical, platform);
  return platform === "win32" ? canonical.toLowerCase() : canonical;
}
