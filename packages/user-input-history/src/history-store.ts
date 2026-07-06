import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createLogger } from "@htwang-contrib/common";
import lockfile from "proper-lockfile";

const logger = createLogger("user-input-history");

export const MAX_ENTRIES = 1000;

export type HistoryEntry = {
  text: string;
  at: number;
};

const HISTORY_LOCK_OPTIONS = {
  stale: 60_000,
  realpath: false,
  retries: {
    forever: true,
    minTimeout: 15,
    maxTimeout: 500,
    randomize: true,
  },
} as const;

let historyWriteChain = Promise.resolve();

function userCacheRoot(): string {
  const raw = process.env.XDG_CACHE_HOME?.trim();
  if (raw) {
    const expanded = raw.startsWith("~/")
      ? join(homedir(), raw.slice(2))
      : raw.startsWith("~")
        ? join(homedir(), raw.slice(1))
        : raw;
    return expanded;
  }
  return join(homedir(), ".cache");
}

function historyFilePath(): string {
  return join(userCacheRoot(), "pi", "user-input-history.json");
}

/** Parent dir must exist before `proper-lockfile` creates `<path>.lock` (mkdir). */
function ensureHistoryParentDir(): void {
  const dir = dirname(historyFilePath());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function normalizeKey(text: string): string {
  return text.trim();
}

function normalizeEntries(entries: HistoryEntry[]): HistoryEntry[] {
  const byText = new Map<string, number>();
  for (const e of entries) {
    const key = normalizeKey(e.text);
    if (!key) continue;
    const at = Number.isFinite(e.at) ? e.at : 0;
    byText.set(key, Math.max(byText.get(key) ?? 0, at));
  }
  return Array.from(byText.entries())
    .map(([text, at]) => ({ text, at }))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_ENTRIES);
}

function migrateStringList(rows: string[]): HistoryEntry[] {
  const base = Date.now();
  const out: HistoryEntry[] = [];
  for (let i = 0; i < rows.length; i++) {
    const t = normalizeKey(rows[i] ?? "");
    if (!t) continue;
    out.push({ text: t, at: base - i });
  }
  return normalizeEntries(out);
}

function parseHistoryPayload(raw: string): HistoryEntry[] {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data) || data.length === 0) return [];
    if (data.every((x) => typeof x === "string")) {
      return migrateStringList(data as string[]);
    }
    const out: HistoryEntry[] = [];
    for (const row of data) {
      if (typeof row === "object" && row !== null && !Array.isArray(row)) {
        const rec = row as Record<string, unknown>;
        const text = typeof rec.text === "string" ? normalizeKey(rec.text) : "";
        if (!text) continue;
        const atRaw = rec.at;
        const at =
          typeof atRaw === "number" && Number.isFinite(atRaw)
            ? atRaw
            : typeof atRaw === "string" && Number.isFinite(Number(atRaw))
              ? Number(atRaw)
              : Date.now();
        out.push({ text, at });
      }
    }
    return normalizeEntries(out);
  } catch {
    return [];
  }
}

function readHistoryFromDisk(): HistoryEntry[] {
  const path = historyFilePath();
  if (!existsSync(path)) return [];
  try {
    return parseHistoryPayload(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

function mergeDiskWithMemory(disk: HistoryEntry[], memory: string[]): HistoryEntry[] {
  const byText = new Map<string, number>();
  for (const e of disk) {
    const key = normalizeKey(e.text);
    if (!key) continue;
    byText.set(key, Math.max(byText.get(key) ?? 0, e.at));
  }
  const now = Date.now();
  for (let i = 0; i < memory.length; i++) {
    const key = normalizeKey(memory[i] ?? "");
    if (!key) continue;
    byText.set(key, Math.max(byText.get(key) ?? 0, now - i));
  }
  return normalizeEntries(Array.from(byText.entries()).map(([text, at]) => ({ text, at })));
}

function writeHistoryAtomic(path: string, entries: HistoryEntry[]): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const slice = normalizeEntries(entries);
  writeFileSync(tmp, `${JSON.stringify(slice, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function loadHistory(): HistoryEntry[] {
  return readHistoryFromDisk();
}

export function loadHistoryTextsNewestFirst(): string[] {
  return loadHistory().map((e) => e.text);
}

export function persistHistoryMergedWithDisk(memory: string[]): void {
  historyWriteChain = historyWriteChain
    .then(async () => {
      const path = historyFilePath();
      ensureHistoryParentDir();
      const release = await lockfile.lock(path, { ...HISTORY_LOCK_OPTIONS });
      try {
        const disk = readHistoryFromDisk();
        const merged = mergeDiskWithMemory(disk, memory);
        writeHistoryAtomic(path, merged);
      } finally {
        await release();
      }
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`persist failed: ${message}`);
    });
}
