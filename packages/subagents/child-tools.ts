const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"] as const;
const FULL_BUILTIN_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;

export const SUBAGENT_DELEGATION_TOOL_NAMES = [
  "subagent",
  "subagent_status",
] as const;

const DELEGATION = new Set<string>(SUBAGENT_DELEGATION_TOOL_NAMES);

export function childSessionToolNames(isolated: boolean): string[] {
  const raw = isolated ? [...READ_ONLY_TOOLS] : [...FULL_BUILTIN_TOOLS];
  return raw.filter((n) => !DELEGATION.has(n));
}
