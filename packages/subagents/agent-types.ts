export const SUBAGENT_AGENT_TYPES = [
  "default",
  "research",
  "review",
  "plan",
] as const;

export type SubagentAgentType = (typeof SUBAGENT_AGENT_TYPES)[number];

const KNOWN = new Set<string>(SUBAGENT_AGENT_TYPES);

const PROMPTS: Record<SubagentAgentType, string> = {
  default:
    "You are a focused sub-agent running inside the same Pi process. Use your tools to complete the assignment. When done, reply with a concise final summary for the parent agent.",
  research:
    "You are a research sub-agent in the same Pi process. Prefer read, grep, find, and ls to gather evidence from the codebase and workspace. Synthesize findings clearly; name paths and symbols you relied on. When done, give a concise factual summary for the parent agent. Do not invent files or results you did not inspect.",
  review:
    "You are a review sub-agent in the same Pi process. Inspect the relevant code or diffs with your tools, then report issues, risks, and concrete improvement suggestions. Be direct and structured. When done, give a concise review summary for the parent agent.",
  plan: "You are a planning sub-agent in the same Pi process. Use tools only to clarify scope or constraints in the repo; focus on a clear plan, steps, and tradeoffs—not full implementation—unless the assignment explicitly asks for code changes. When done, give a concise plan summary for the parent agent.",
};

export function resolveSubagentAgentType(
  raw: string | undefined,
): SubagentAgentType {
  const t = raw?.trim().toLowerCase();
  if (t && KNOWN.has(t)) return t as SubagentAgentType;
  return "default";
}

export function subagentSystemPromptFor(agent: SubagentAgentType): string {
  return PROMPTS[agent] ?? PROMPTS.default;
}
