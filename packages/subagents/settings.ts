import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_MAX_TOTAL = 8;
const ABS_MAX_CONCURRENT = 64;
const ABS_MAX_TOTAL = 32;

const SETTINGS_PATH = path.join(
  os.homedir(),
  ".agent",
  "subagents",
  "settings.json",
);

type FileShape = {
  max_concurrent?: number;
  max_total?: number;
};

function clampInt(v: unknown, lo: number, hi: number, fallback: number) {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  const x = Math.floor(v);
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

export function readSubagentConcurrencyLimits(overrides?: {
  max_concurrent?: number;
  max_total?: number;
}): { maxConcurrent: number; maxTotal: number } {
  let maxConcurrent = DEFAULT_MAX_CONCURRENT;
  let maxTotal = DEFAULT_MAX_TOTAL;
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const j = JSON.parse(raw) as FileShape;
    maxConcurrent = clampInt(
      j.max_concurrent,
      1,
      ABS_MAX_CONCURRENT,
      DEFAULT_MAX_CONCURRENT,
    );
    maxTotal = clampInt(j.max_total, 1, ABS_MAX_TOTAL, DEFAULT_MAX_TOTAL);
  } catch {}
  if (overrides?.max_concurrent !== undefined) {
    maxConcurrent = clampInt(
      overrides.max_concurrent,
      1,
      ABS_MAX_CONCURRENT,
      maxConcurrent,
    );
  }
  if (overrides?.max_total !== undefined) {
    maxTotal = clampInt(overrides.max_total, 1, ABS_MAX_TOTAL, maxTotal);
  }
  if (maxTotal < maxConcurrent) {
    maxTotal = maxConcurrent;
  }
  return { maxConcurrent, maxTotal };
}
