import type { SessionEntry } from "@earendil-works/pi-coding-agent";

const IDLE_FLOOR_RATIO = 0.5;

export const CURRENT_TURN_TOLERANCE_MS = 10_000;

export interface IdleCompactInput {
  gapMs: number | null;
  tokens: number;
  contextWindow: number;
  thresholdMinutes: number;
}

function entryTimeMs(entry: SessionEntry): number | null {
  const ms = Date.parse(entry.timestamp);
  return Number.isNaN(ms) ? null : ms;
}

function startsCurrentTurn(entry: SessionEntry, now: number): boolean {
  if (entry.type !== "message" || entry.message.role !== "user") return false;
  const ms = entryTimeMs(entry);
  return ms !== null && now - ms <= CURRENT_TURN_TOLERANCE_MS;
}

export function computeIdleGapMs(entries: SessionEntry[], now: number): number | null {
  const tailIndex = entries.length - 1;
  if (tailIndex < 0) return null;
  const tail = entries[tailIndex];
  const index = startsCurrentTurn(tail, now) && tailIndex > 0 ? tailIndex - 1 : tailIndex;
  const ms = entryTimeMs(entries[index]);
  if (ms === null) return null;
  return Math.max(0, now - ms);
}

export function shouldIdleCompact(input: IdleCompactInput): boolean {
  if (input.thresholdMinutes <= 0) return false;
  if (input.gapMs === null) return false;
  if (input.contextWindow <= 0) return false;
  if (input.tokens < input.contextWindow * IDLE_FLOOR_RATIO) return false;
  return input.gapMs >= input.thresholdMinutes * 60_000;
}

export function normalizeIdleCompactMinutes(value: unknown): number {
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isFinite(num) || num < 0) return 0;
  return num;
}
