import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_STAT_TTL_MS } from "@htwang-contrib/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeUsage, toPiUsage } from "../src/usage-report.ts";

const SNAP = {
  usage_input: 100,
  usage_output: 40,
  usage_cache_read: 900,
  usage_cache_write: 10,
  usage_cost_usd: 0.0123,
};

describe("toPiUsage", () => {
  it("maps a snapshot to a full pi Usage including cacheRead and cost", () => {
    const u = toPiUsage(SNAP);
    expect(u).toEqual({
      input: 100,
      output: 40,
      cacheRead: 900,
      cacheWrite: 10,
      totalTokens: 1050,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.0123 },
    });
  });

  it("returns undefined when nothing was spent", () => {
    expect(
      toPiUsage({
        usage_input: 0,
        usage_output: 0,
        usage_cache_read: 0,
        usage_cache_write: 0,
        usage_cost_usd: 0,
      }),
    ).toBeUndefined();
  });

  it("tolerates missing optional fields", () => {
    const u = toPiUsage({ usage_input: 5, usage_output: 2 });
    expect(u?.totalTokens).toBe(7);
    expect(u?.cost.total).toBe(0);
  });
});

describe("background usage pool", () => {
  let dir: string;
  let nowMs: number;
  let mod: typeof import("../src/usage-report.ts");

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "usage-report-test-"));
    vi.stubEnv("XDG_CONFIG_HOME", dir);
    nowMs = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    vi.resetModules();
    mod = await import("../src/usage-report.ts");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  // External config edits are observed after the config stat TTL; the mocked
  // clock advances past it so each write is visible to the next read.
  function setReportUsage(on: boolean) {
    mkdirSync(join(dir, "pi"), { recursive: true });
    writeFileSync(join(dir, "pi", "extensions.json"), JSON.stringify({ subagents: { reportUsage: on } }));
    nowMs += CONFIG_STAT_TTL_MS + 1;
  }

  it("is off by default", () => {
    expect(mod.loadReportUsage()).toBe(false);
  });

  it("pools and drains once per parent session when enabled", () => {
    setReportUsage(true);
    mod.poolBackgroundUsage("p1", SNAP);
    mod.poolBackgroundUsage("p1", SNAP);
    const drained = mod.drainBackgroundUsage("p1");
    expect(drained?.input).toBe(200);
    expect(drained?.cacheRead).toBe(1800);
    expect(drained?.cost.total).toBeCloseTo(0.0246);
    expect(mod.drainBackgroundUsage("p1")).toBeUndefined();
  });

  it("keeps pools isolated per parent session", () => {
    setReportUsage(true);
    mod.poolBackgroundUsage("p1", SNAP);
    mod.poolBackgroundUsage("p2", SNAP);
    expect(mod.drainBackgroundUsage("p2")?.input).toBe(100);
    expect(mod.drainBackgroundUsage("p1")?.input).toBe(100);
  });

  it("does not pool when disabled", () => {
    setReportUsage(false);
    mod.poolBackgroundUsage("p1", SNAP);
    expect(mod.drainBackgroundUsage("p1")).toBeUndefined();
  });

  it("does not drain when disabled", () => {
    setReportUsage(true);
    mod.poolBackgroundUsage("p1", SNAP);
    setReportUsage(false);
    expect(mod.drainBackgroundUsage("p1")).toBeUndefined();
  });
});

describe("mergeUsage", () => {
  it("sums both sides", () => {
    const a = toPiUsage(SNAP);
    const b = toPiUsage({ usage_input: 1, usage_output: 1 });
    const merged = mergeUsage(a, b);
    expect(merged?.input).toBe(101);
    expect(merged?.output).toBe(41);
    expect(merged?.cacheRead).toBe(900);
    expect(merged?.cost.total).toBeCloseTo(0.0123);
  });

  it("passes through undefined sides", () => {
    const a = toPiUsage(SNAP);
    expect(mergeUsage(undefined, undefined)).toBeUndefined();
    expect(mergeUsage(a, undefined)).toBe(a);
    expect(mergeUsage(undefined, a)).toBe(a);
  });
});
