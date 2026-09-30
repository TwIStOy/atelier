import { readRawConfig } from "../config/extension-config.ts";
import { normalizePersonaId } from "./agent-personas.ts";

export const SUBAGENT_MODEL_TIERS = ["cheap", "middle", "flagship"] as const;

export type SubagentModelTier = (typeof SUBAGENT_MODEL_TIERS)[number];

export type SubagentModelConfig = {
  modelTiers: Partial<Record<SubagentModelTier, string>>;
  agentModels: Partial<Record<string, string>>;
};

export function loadSubagentModelConfig(): SubagentModelConfig {
  const raw = readRawConfig("subagents");
  const modelTiers: SubagentModelConfig["modelTiers"] = {};
  const agentModels: SubagentModelConfig["agentModels"] = Object.create(null);
  const tiers = raw?.modelTiers;
  if (tiers && typeof tiers === "object" && !Array.isArray(tiers)) {
    for (const tier of SUBAGENT_MODEL_TIERS) {
      const value = (tiers as Record<string, unknown>)[tier];
      if (typeof value === "string" && value.trim()) modelTiers[tier] = value.trim();
    }
  }
  const agents = raw?.agentModels;
  if (agents && typeof agents === "object" && !Array.isArray(agents)) {
    for (const [key, value] of Object.entries(agents)) {
      const id = normalizePersonaId(key);
      if (id && typeof value === "string") agentModels[id] = value.trim();
    }
  }
  return { modelTiers, agentModels };
}

export function resolveSubagentModelPattern(
  raw: string | undefined,
  tiers: SubagentModelConfig["modelTiers"],
): string | undefined {
  const pattern = raw?.trim();
  if (!pattern) return undefined;
  const tier = SUBAGENT_MODEL_TIERS.find((value) => value === pattern);
  return tier ? tiers[tier] : pattern;
}
