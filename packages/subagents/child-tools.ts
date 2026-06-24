const READ_ONLY_TOOLS = ["read", "grep", "glob", "ls", "web_search", "web_fetch"] as const;
const FULL_BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "glob", "ls", "web_search", "web_fetch"] as const;

export const SUBAGENT_DELEGATION_TOOL_NAMES = ["subagent", "subagent_status"] as const;

const DELEGATION = new Set<string>(SUBAGENT_DELEGATION_TOOL_NAMES);

export function childSessionToolNames(isolated: boolean): string[] {
  const raw = isolated ? [...READ_ONLY_TOOLS] : [...FULL_BUILTIN_TOOLS];
  return raw.filter((n) => !DELEGATION.has(n));
}

export function resolveChildToolNames(isolated: boolean, personaTools: string[] | undefined): string[] {
  const base = childSessionToolNames(isolated);
  if (!personaTools?.length) return base;
  const allow = new Set(base);
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const raw of personaTools) {
    const t = raw.trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    if (!allow.has(t)) continue;
    seen.add(t);
    picked.push(t);
  }
  return picked.length ? picked : base;
}
