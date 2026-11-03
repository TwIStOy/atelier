import { readRawConfig } from "../config/extension-config.ts";
import { normalizePersonaId } from "./agent-personas.ts";

export const SUBAGENT_MODEL_TIERS = ["cheap", "middle", "flagship"] as const;

export type SubagentModelTier = (typeof SUBAGENT_MODEL_TIERS)[number];

export type SubagentModelConfig = {
  modelTiers: Partial<Record<SubagentModelTier, string>>;
  agentModels: Partial<Record<string, string>>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseModelTierConfig(tiers: unknown): SubagentModelConfig["modelTiers"] {
  const modelTiers: SubagentModelConfig["modelTiers"] = {};
  if (!isPlainObject(tiers)) return modelTiers;
  for (const tier of SUBAGENT_MODEL_TIERS) {
    const value = tiers[tier];
    if (typeof value === "string" && value.trim()) modelTiers[tier] = value.trim();
  }
  return modelTiers;
}

function collectAgentModelPatterns(
  agents: Record<string, unknown>,
  agentModels: SubagentModelConfig["agentModels"],
): void {
  for (const [key, value] of Object.entries(agents)) {
    const id = normalizePersonaId(key);
    if (id && typeof value === "string") agentModels[id] = value.trim();
  }
}

function parseAgentModelConfig(agents: unknown): SubagentModelConfig["agentModels"] {
  const agentModels: SubagentModelConfig["agentModels"] = Object.create(null);
  if (!isPlainObject(agents)) return agentModels;
  collectAgentModelPatterns(agents, agentModels);
  return agentModels;
}

export function loadSubagentModelConfig(): SubagentModelConfig {
  const raw = readRawConfig("subagents");
  return {
    modelTiers: parseModelTierConfig(raw?.modelTiers),
    agentModels: parseAgentModelConfig(raw?.agentModels),
  };
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
