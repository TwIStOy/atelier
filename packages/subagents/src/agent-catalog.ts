import {
  type AgentPersonaCatalog,
  buildAgentPersonaCatalog,
  normalizePersonaId,
  personasCatalogXml,
  resolvePersonaId,
} from "@htwang-contrib/common";

import { FALLBACK_AGENT_NONE, type SubagentSettings } from "./settings.ts";

export type SubagentAgentCatalog = AgentPersonaCatalog;

export function buildSubagentAgentCatalog(cwd: string): SubagentAgentCatalog {
  return buildAgentPersonaCatalog(cwd);
}

export function resolveSubagentAgentId(raw: string | undefined, catalog: SubagentAgentCatalog): string {
  return resolvePersonaId(raw, catalog);
}

export type DispatchResolution = { ok: true; id: string; requested?: string } | { ok: false; message: string };

export function resolveDispatchAgentId(
  raw: string | undefined,
  catalog: SubagentAgentCatalog,
  settings: SubagentSettings,
): DispatchResolution {
  const requested = normalizePersonaId(raw ?? "");
  if (!requested) return { ok: true, id: resolvePersonaId(undefined, catalog) };
  if (catalog.agents.has(requested)) return { ok: true, id: requested };

  const available = [...catalog.agents.keys()].sort((a, b) => a.localeCompare(b)).join(", ");
  const fallback = settings.fallbackAgent;
  if (fallback === FALLBACK_AGENT_NONE) {
    return {
      ok: false,
      message: `subagent: unknown agent_type "${requested}" and fallback_agent is "none". Available types: ${available}.`,
    };
  }
  if (!catalog.agents.has(fallback)) {
    return {
      ok: false,
      message: `subagent: unknown agent_type "${requested}", and the configured fallback_agent "${fallback}" does not resolve to a known agent either. Available types: ${available}.`,
    };
  }
  return { ok: true, id: fallback, requested };
}

export function subagentsPersonasSystemPromptXml(catalog: SubagentAgentCatalog): string {
  return personasCatalogXml(catalog);
}
