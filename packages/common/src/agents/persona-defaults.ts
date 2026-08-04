import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { FALLBACK_PERSONA_ID, normalizePersonaId } from "./agent-personas.ts";

export type PersonaTypeDefaults = {
  model?: string;
  thinking?: string;
};

export function personaDefaultsFilePath(): string {
  return path.join(getAgentDir(), "subagents", "settings.json");
}

export function parsePersonaDefaultsByType(raw: unknown): Partial<Record<string, PersonaTypeDefaults>> {
  const out: Partial<Record<string, PersonaTypeDefaults>> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    const nk = normalizePersonaId(k);
    if (!nk) continue;
    const v = obj[k];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const row = v as Record<string, unknown>;
    const model = typeof row.model === "string" && row.model.trim() ? row.model.trim() : undefined;
    const thinking = typeof row.thinking === "string" && row.thinking.trim() ? row.thinking.trim() : undefined;
    if (model || thinking) {
      out[nk] = {
        ...(model ? { model } : {}),
        ...(thinking ? { thinking } : {}),
      };
    }
  }
  return out;
}

export function readPersonaDefaultsByType(): Partial<Record<string, PersonaTypeDefaults>> {
  const file = personaDefaultsFilePath();
  if (!fs.existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsePersonaDefaultsByType((parsed as Record<string, unknown>).defaults_by_agent_type);
}

export function personaDefaultsForType(
  defaults: Partial<Record<string, PersonaTypeDefaults>>,
  agentType: string,
): PersonaTypeDefaults {
  const key = normalizePersonaId(agentType) || FALLBACK_PERSONA_ID;
  return defaults[key] ?? {};
}
