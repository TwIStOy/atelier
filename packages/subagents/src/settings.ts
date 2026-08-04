import * as fs from "node:fs";
import {
  type PersonaTypeDefaults,
  parsePersonaDefaultsByType,
  personaDefaultsFilePath,
  personaDefaultsForType,
} from "@htwang-contrib/common";

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_TOTAL = 10;
const DEFAULT_TIMEOUT_MS = 0;

export type SubagentAgentTypeDefaults = PersonaTypeDefaults;

export type SubagentSettings = {
  maxConcurrent: number;
  maxTotal: number;
  timeoutMs: number;
  defaultsByAgentType: Partial<Record<string, SubagentAgentTypeDefaults>>;
};

function parsePositiveInt(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  const n = Math.floor(v);
  return n > 0 ? n : fallback;
}

function parseNonNegativeInt(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  const n = Math.floor(v);
  return n >= 0 ? n : fallback;
}

function readSettingsFile(): unknown {
  const file = personaDefaultsFilePath();
  if (!fs.existsSync(file)) return undefined;
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export type SubagentSettingsOverrides = {
  max_concurrent?: number;
  max_total?: number;
  timeout_ms?: number;
};

export function readSubagentSettings(overrides?: SubagentSettingsOverrides): SubagentSettings {
  const parsed = readSettingsFile();
  let maxConcurrent = DEFAULT_MAX_CONCURRENT;
  let maxTotal = DEFAULT_MAX_TOTAL;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let defaultsByAgentType: Partial<Record<string, SubagentAgentTypeDefaults>> = {};

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    maxConcurrent = parsePositiveInt(o.max_concurrent, DEFAULT_MAX_CONCURRENT);
    maxTotal = parsePositiveInt(o.max_total, DEFAULT_MAX_TOTAL);
    timeoutMs = parseNonNegativeInt(o.timeout_ms, DEFAULT_TIMEOUT_MS);
    defaultsByAgentType = parsePersonaDefaultsByType(o.defaults_by_agent_type);
  }

  if (overrides?.max_concurrent !== undefined) {
    maxConcurrent = parsePositiveInt(overrides.max_concurrent, maxConcurrent);
  }
  if (overrides?.max_total !== undefined) {
    maxTotal = parsePositiveInt(overrides.max_total, maxTotal);
  }
  if (overrides?.timeout_ms !== undefined) {
    timeoutMs = parseNonNegativeInt(overrides.timeout_ms, timeoutMs);
  }

  return { maxConcurrent, maxTotal, timeoutMs, defaultsByAgentType };
}

export function readSubagentConcurrencyLimits(
  overrides?: Pick<SubagentSettingsOverrides, "max_concurrent" | "max_total">,
): { maxConcurrent: number; maxTotal: number } {
  const s = readSubagentSettings(overrides);
  return { maxConcurrent: s.maxConcurrent, maxTotal: s.maxTotal };
}

export function resolveTimeoutMs(taskOverride: number | undefined, fallback: number): number {
  if (taskOverride === undefined) return fallback;
  return parseNonNegativeInt(taskOverride, fallback);
}

export function defaultsForAgentType(settings: SubagentSettings, agentType: string): SubagentAgentTypeDefaults {
  return personaDefaultsForType(settings.defaultsByAgentType, agentType);
}
