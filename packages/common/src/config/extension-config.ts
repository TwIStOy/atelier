import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
  const tmp = `${CONFIG_PATH}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, CONFIG_PATH);
}

export function readConfig<T>(extensionId: string, schema: ExtensionConfigSchema<T>): T {
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

export function updateConfig<T>(extensionId: string, schema: ExtensionConfigSchema<T>, patch: Partial<T>): T {
  const current = readConfig(extensionId, schema);
  const updated = { ...current, ...patch };
  writeConfig(extensionId, updated);
  return updated;
}

export function readRawConfig(extensionId: string): Record<string, unknown> | undefined {
  const file = readConfigFile();
  const section = file[extensionId];
  if (section && typeof section === "object" && !Array.isArray(section)) return section as Record<string, unknown>;
  return undefined;
}

function setDeep(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    const next = current[seg];
    if (next == null || typeof next !== "object" || Array.isArray(next)) {
      current[seg] = {};
    }
    current = current[seg] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}

function deleteDeep(obj: Record<string, unknown>, path: string[]): void {
  if (path.length === 1) {
    delete obj[path[0]];
    return;
  }
  const parent = path.slice(0, -1).reduce<Record<string, unknown> | undefined>((cur, seg) => {
    if (cur == null || typeof cur[seg] !== "object" || Array.isArray(cur[seg])) return undefined;
    return cur[seg] as Record<string, unknown>;
  }, obj);
  if (parent != null) {
    delete parent[path[path.length - 1]];
  }
}

export function setConfigKey(extensionId: string, key: string, value: unknown): void {
  const file = readConfigFile();
  if (!file[extensionId] || typeof file[extensionId] !== "object") {
    file[extensionId] = {};
  }
  const segs = key.split(".");
  setDeep(file[extensionId] as Record<string, unknown>, segs, value);
  writeConfigFile(file);
}

export function deleteConfigKey(extensionId: string, key: string): void {
  const file = readConfigFile();
  const section = file[extensionId];
  if (section && typeof section === "object") {
    const segs = key.split(".");
    deleteDeep(section as Record<string, unknown>, segs);
  }
  writeConfigFile(file);
}

export function deleteConfigSection(extensionId: string): void {
  const file = readConfigFile();
  delete file[extensionId];
  writeConfigFile(file);
}
