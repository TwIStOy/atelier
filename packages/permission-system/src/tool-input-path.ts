import { PATH_BEARING_TOOLS } from "./path-surfaces.ts";
import { getNonEmptyString, toRecord } from "./value-guards.ts";

export function getPathBearingToolPath(toolName: string, input: unknown): string | null {
  if (!PATH_BEARING_TOOLS.has(toolName)) {
    return null;
  }
  return getNonEmptyString(toRecord(input).path);
}

/**
 * Extract the filesystem path a tool will access, for the cross-cutting `path`
 * and `external_directory` gates.
 *
 * - `bash` → `null` (bash has its own token-based path gates).
 * - Built-in path-bearing tools → `input.path`.
 * - Any other tool → `input.path` convention (extension/MCP extractors are
 *   post-v1; the registry seam is left for Step 3+).
 */
export function getToolInputPath(toolName: string, input: unknown): string | null {
  if (toolName === "bash") {
    return null;
  }
  const record = toRecord(input);
  if (PATH_BEARING_TOOLS.has(toolName)) {
    return getNonEmptyString(record.path);
  }
  return getNonEmptyString(record.path);
}
