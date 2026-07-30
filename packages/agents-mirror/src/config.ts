import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "@htwang-contrib/common";
import type { MirrorMappings } from "./types.ts";

export const CONFIG_ID = "agents-mirror";
const FILE = "agents-mirror.json";

export function defaultConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg ? join(xdg, "pi") : join(homedir(), ".config", "pi");
  return join(base, FILE);
}

interface AgentsMirrorConfig {
  configPath: string;
  inlineEntry: boolean;
}

const CONFIG_SCHEMA: ExtensionConfigSchema<AgentsMirrorConfig> = {
  defaults: { configPath: defaultConfigPath(), inlineEntry: true },
};

export function loadConfigPath(): string {
  return readConfig(CONFIG_ID, CONFIG_SCHEMA).configPath;
}

export function loadInlineEntry(): boolean {
  return readConfig(CONFIG_ID, CONFIG_SCHEMA).inlineEntry;
}

export function registerConfig(): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "configPath",
      type: "string",
      label: "Mapping File Path",
      value: () => loadConfigPath(),
      description:
        "Path to the JSON file mapping each project root (absolute) to its agents.md mirror root (absolute).",
      extensionLabel: "Agents Mirror",
      order: 0,
    },
    {
      key: "inlineEntry",
      type: "boolean",
      label: "Inline Chat Entry",
      value: () => loadInlineEntry(),
      description: "When on, each successful injection renders a compact row in the chat body (not sent to the LLM).",
      extensionLabel: "Agents Mirror",
      order: 10,
    },
  ]);
}

let cache: { path: string; mtimeMs: number; mappings: MirrorMappings } | null = null;

export function clearMappingsCache(): void {
  cache = null;
}

export function loadMappings(configPath: string): MirrorMappings {
  if (!existsSync(configPath)) return {};
  let mtimeMs: number;
  try {
    mtimeMs = statSync(configPath).mtimeMs;
  } catch {
    return {};
  }
  if (cache && cache.path === configPath && cache.mtimeMs === mtimeMs) {
    return cache.mappings;
  }
  const mappings = readMappingsFile(configPath);
  cache = { path: configPath, mtimeMs, mappings };
  return mappings;
}

function readMappingsFile(configPath: string): MirrorMappings {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
  return normalizeMappings(raw);
}

export function normalizeMappings(raw: unknown): MirrorMappings {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const mappings: MirrorMappings = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key === "string" && key.length > 0 && typeof value === "string" && value.length > 0) {
      mappings[key] = value;
    }
  }
  return mappings;
}
