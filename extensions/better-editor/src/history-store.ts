import {
  existsSync,
  mkdir,
  mkdirSync,
  readFileSync,
  realpath,
  renameSync,
  rmdir,
  rmdirSync,
  stat,
  utimes,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createLogger } from "@htwang-contrib/common";
import lockfile from "proper-lockfile";

const logger = createLogger("better-editor");

export const MAX_ENTRIES = 1000;

type HistoryEntry = {
  text: string;
  at: number;
};

const plainLockFs = {
  mkdir,
  rmdir,
  rmdirSync,
  stat,
  utimes,
  realpath,
};

const HISTORY_LOCK_OPTIONS = {
  stale: 60_000,
  realpath: false,
  fs: plainLockFs,
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

function ensureHistoryParentDir(): void {
  const dir = dirname(historyFilePath());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function normalizeKey(text: string): string {
  return text.trim();
}

function finiteAt(at: number): number {
  return Number.isFinite(at) ? at : 0;
}

function entriesFromMap(byText: Map<string, number>): HistoryEntry[] {
  return Array.from(byText.entries()).map(([text, at]) => ({ text, at }));
}

function normalizeEntries(entries: HistoryEntry[]): HistoryEntry[] {
  const byText = new Map<string, number>();
  for (const e of entries) {
    const key = normalizeKey(e.text);
    if (!key) continue;
    byText.set(key, Math.max(byText.get(key) ?? 0, finiteAt(e.at)));
  }
  return entriesFromMap(byText)
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

function coerceNumberAt(atRaw: unknown): number | undefined {
  if (typeof atRaw === "number" && Number.isFinite(atRaw)) return atRaw;
  return undefined;
}

function coerceStringAt(atRaw: unknown): number | undefined {
  if (typeof atRaw === "string" && Number.isFinite(Number(atRaw))) return Number(atRaw);
  return undefined;
}

function coerceAt(atRaw: unknown): number {
  return coerceNumberAt(atRaw) ?? coerceStringAt(atRaw) ?? Date.now();
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEntryText(rec: Record<string, unknown>): string {
  return typeof rec.text === "string" ? normalizeKey(rec.text) : "";
}

function parseRecordEntry(row: unknown): HistoryEntry | undefined {
  if (!isRecordObject(row)) return undefined;
  const text = parseEntryText(row);
  if (!text) return undefined;
  return { text, at: coerceAt(row.at) };
}

function parseRowEntries(data: unknown[]): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const row of data) {
    const entry = parseRecordEntry(row);
    if (entry) out.push(entry);
  }
  return out;
}

function parseHistoryPayload(raw: string): HistoryEntry[] {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data) || data.length === 0) return [];
    if (data.every((x) => typeof x === "string")) {
      return migrateStringList(data as string[]);
    }
    return normalizeEntries(parseRowEntries(data));
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

function bumpTimestamp(byText: Map<string, number>, key: string, at: number): void {
  byText.set(key, Math.max(byText.get(key) ?? 0, at));
}

function absorbDiskEntries(byText: Map<string, number>, disk: HistoryEntry[]): void {
  for (const e of disk) {
    const key = normalizeKey(e.text);
    if (!key) continue;
    bumpTimestamp(byText, key, e.at);
  }
}

function absorbMemoryEntries(byText: Map<string, number>, memory: string[], now: number): void {
  for (let i = 0; i < memory.length; i++) {
    const key = normalizeKey(memory[i] ?? "");
    if (!key) continue;
    bumpTimestamp(byText, key, now - i);
  }
}

function mergeDiskWithMemory(disk: HistoryEntry[], memory: string[]): HistoryEntry[] {
  const byText = new Map<string, number>();
  absorbDiskEntries(byText, disk);
  absorbMemoryEntries(byText, memory, Date.now());
  return normalizeEntries(entriesFromMap(byText));
}

function writeHistoryAtomic(path: string, entries: HistoryEntry[]): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const slice = normalizeEntries(entries);
  writeFileSync(tmp, `${JSON.stringify(slice, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function loadHistory(): HistoryEntry[] {
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
