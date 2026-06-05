import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface ExtensionConfigSchema<T> {
  defaults: T;
}

type ConfigFile = Record<string, Record<string, unknown>>;

const CONFIG_PATH = configPath();

function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg ? join(xdg, "pi") : join(homedir(), ".config", "pi");
  return join(base, "extensions.json");
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readConfigFile(): ConfigFile {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeConfigFile(data: ConfigFile): void {
  ensureDir(CONFIG_PATH);
  const tmp = CONFIG_PATH + `.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  renameSync(tmp, CONFIG_PATH);
}

export function readConfig<T>(
  extensionId: string,
  schema: ExtensionConfigSchema<T>,
): T {
  const file = readConfigFile();
  const section = file[extensionId];
  if (!section || typeof section !== "object") return { ...schema.defaults };
  return { ...schema.defaults, ...section };
}

export function writeConfig<T>(extensionId: string, config: T): void {
  const file = readConfigFile();
  file[extensionId] = config as Record<string, unknown>;
  writeConfigFile(file);
}

export function updateConfig<T>(
  extensionId: string,
  schema: ExtensionConfigSchema<T>,
  patch: Partial<T>,
): T {
  const current = readConfig(extensionId, schema);
  const updated = { ...current, ...patch };
  writeConfig(extensionId, updated);
  return updated;
}
