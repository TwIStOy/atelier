import type { ToolAction } from "./types.ts";

export const READ_ONLY_PATH_BEARING_TOOLS: ReadonlySet<string> = new Set(["read", "find", "grep", "ls"]);

export const PATH_BEARING_TOOLS = new Set(["read", "write", "edit", "find", "grep", "ls"]);

export const PATH_SURFACES: ReadonlySet<string> = new Set([...PATH_BEARING_TOOLS, "external_directory", "path"]);

/**
 * Derive the operation category a tool performs, for the gate result's
 * `action` field. `write`/`edit` → write; read-only path tools → read; `bash`
 * → execute; anything else defaults to read (least-assumption).
 *
 * `delete` is reserved — not inferred here; a future bash-verb detector or a
 * dedicated delete tool would emit it.
 */
export function actionFromTool(toolName: string): ToolAction {
  if (toolName === "write" || toolName === "edit") return "write";
  if (toolName === "bash") return "execute";
  return "read";
}
