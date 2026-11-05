import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface ExtensionConfigSchema<T> {
  defaults: T;
}

type ConfigFile = Record<string, Record<string, unknown>>;

function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg ? join(xdg, "pi") : join(homedir(), ".config", "pi");
  return join(base, "extensions.json");
}

let configFileVersion = 0;
let configStatCheckedAtMs = 0;
// `data: undefined` marks a stat'd-but-absent (or unparseable) file, so the
// missing-file case is also cached instead of re-statting on every read.
type ConfigFileCacheEntry = { path: string; mtimeMs: number; size: number; data: ConfigFile | undefined };
let configFileCache: ConfigFileCacheEntry | undefined;

// Render paths call readConfig() per tool row per frame; stat the file at most
// once per window. In-process writes refresh the cache directly, so the TTL only
// delays observing edits made by other processes (imperceptible for humans).
export const CONFIG_STAT_TTL_MS = 500;

// Bumped on every in-process write and whenever an on-disk change is observed,
// so render paths can key caches on config state without re-reading the file.
export function getConfigFileVersion(): number {
  return configFileVersion;
}

function statConfigFile(path: string): { mtimeMs: number; size: number } | undefined {
  try {
    const st = statSync(path);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return undefined;
  }
}

function parseConfigFile(path: string): ConfigFile | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ConfigFile;
  } catch {
    return undefined;
  }
}

function statMatchesCache(
  cached: ConfigFileCacheEntry | undefined,
  path: string,
  stat: { mtimeMs: number; size: number } | undefined,
): boolean {
  if (!cached || cached.path !== path) return false;
  if (!stat) return cached.mtimeMs === -1 && cached.size === -1;
  return cached.mtimeMs === stat.mtimeMs && cached.size === stat.size;
}

function buildCacheEntry(path: string, stat: { mtimeMs: number; size: number } | undefined): ConfigFileCacheEntry {
  if (!stat) return { path, mtimeMs: -1, size: -1, data: undefined };
  return { path, mtimeMs: stat.mtimeMs, size: stat.size, data: parseConfigFile(path) };
}

function readConfigFile(): ConfigFile {
  const path = configPath();
  const now = Date.now();
  const cached = configFileCache;
  if (cached !== undefined && cached.path === path && now - configStatCheckedAtMs < CONFIG_STAT_TTL_MS) {
    return cached.data ?? {};
  }
  configStatCheckedAtMs = now;
  const stat = statConfigFile(path);
  if (statMatchesCache(cached, path, stat)) return cached?.data ?? {};
  configFileVersion++;
  const entry = buildCacheEntry(path, stat);
  configFileCache = entry;
  return entry.data ?? {};
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeConfigFile(data: ConfigFile): void {
  const path = configPath();
  ensureDir(path);
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
  configStatCheckedAtMs = Date.now();
  try {
    const st = statSync(path);
    configFileCache = { path, mtimeMs: st.mtimeMs, size: st.size, data };
  } catch {
    configFileCache = undefined;
  }
  configFileVersion++;
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
