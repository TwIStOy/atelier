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

function trimmedStringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parsePersonaDefaultsRow(row: unknown): PersonaTypeDefaults | undefined {
  if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
  const record = row as Record<string, unknown>;
  const model = trimmedStringField(record.model);
  const thinking = trimmedStringField(record.thinking);
  if (!model && !thinking) return undefined;
  return {
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
  };
}

export function parsePersonaDefaultsByType(raw: unknown): Partial<Record<string, PersonaTypeDefaults>> {
  const out: Partial<Record<string, PersonaTypeDefaults>> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    const nk = normalizePersonaId(k);
    if (!nk) continue;
    const row = parsePersonaDefaultsRow(obj[k]);
    if (row) out[nk] = row;
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
