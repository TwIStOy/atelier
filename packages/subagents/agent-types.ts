import type { SubagentAgentCatalog } from "./agent-catalog.ts";
import {
  resolveSubagentAgentId,
  subagentSystemPromptFromCatalog,
} from "./agent-catalog.ts";

export type SubagentAgentType = string;

export function resolveSubagentAgentType(
  raw: string | undefined,
  catalog: SubagentAgentCatalog,
): string {
  return resolveSubagentAgentId(raw, catalog);
}

export function subagentSystemPromptFor(
  agent: string,
  catalog: SubagentAgentCatalog,
): string {
  return subagentSystemPromptFromCatalog(agent, catalog);
}
