import {
  type AgentPersonaCatalog,
  type AgentPersonaEntry,
  type AgentPersonaFileOptions,
  buildAgentPersonaCatalog,
  FALLBACK_PERSONA_ID,
  normalizePersonaId,
  personaSystemPrompt,
  personasCatalogXml,
  resolvePersonaId,
} from "@htwang-contrib/common";

export const SUBAGENT_FALLBACK_AGENT_ID = FALLBACK_PERSONA_ID;

export type SubagentAgentFileOptions = AgentPersonaFileOptions;
export type SubagentAgentEntry = AgentPersonaEntry;
export type SubagentAgentCatalog = AgentPersonaCatalog;
export type SubagentAgentType = string;

export function buildSubagentAgentCatalog(cwd: string): SubagentAgentCatalog {
  return buildAgentPersonaCatalog(cwd);
}

export const normalizeSubagentAgentId = normalizePersonaId;

export function resolveSubagentAgentId(raw: string | undefined, catalog: SubagentAgentCatalog): string {
  return resolvePersonaId(raw, catalog);
}

export function subagentSystemPromptFromCatalog(agentId: string, catalog: SubagentAgentCatalog): string {
  return personaSystemPrompt(agentId, catalog);
}

export function subagentsPersonasSystemPromptXml(catalog: SubagentAgentCatalog): string {
  return personasCatalogXml(catalog);
}
