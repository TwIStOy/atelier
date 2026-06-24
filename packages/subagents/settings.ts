import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { normalizeSubagentAgentId, SUBAGENT_FALLBACK_AGENT_ID } from "./agent-catalog.ts";

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_TOTAL = 10;
const DEFAULT_TIMEOUT_MS = 0;

export type SubagentAgentTypeDefaults = {
  model?: string;
  thinking?: string;
};

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

function parseDefaultsByAgentType(raw: unknown): Partial<Record<string, SubagentAgentTypeDefaults>> {
  const out: Partial<Record<string, SubagentAgentTypeDefaults>> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    const nk = normalizeSubagentAgentId(k);
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

function readSettingsFile(): unknown {
  const agentDir = getAgentDir();
  const file = path.join(agentDir, "subagents", "settings.json");
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
    defaultsByAgentType = parseDefaultsByAgentType(o.defaults_by_agent_type);
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
  const key = normalizeSubagentAgentId(agentType) || SUBAGENT_FALLBACK_AGENT_ID;
  return settings.defaultsByAgentType[key] ?? {};
}
