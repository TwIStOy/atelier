import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  CURRENT_TURN_TOLERANCE_MS,
  computeIdleGapMs,
  normalizeIdleCompactMinutes,
  shouldIdleCompact,
} from "../src/idle.ts";
import { compactionEntry, messageEntry } from "./helpers.ts";

const MINUTE = 60_000;

describe("computeIdleGapMs", () => {
  it("measures the gap from the last entry timestamp", () => {
    const now = Date.now();
    const entries = [messageEntry("user", now - 90 * MINUTE), messageEntry("assistant", now - 60 * MINUTE)];
    expect(computeIdleGapMs(entries, now)).toBe(60 * MINUTE);
  });

  it("returns null for an empty branch", () => {
    expect(computeIdleGapMs([], Date.now())).toBeNull();
  });

  it("returns null when the tail timestamp is unparseable", () => {
    const now = Date.now();
    const entries = [{ ...messageEntry("assistant", now - 60 * MINUTE), timestamp: "not-a-date" }] as SessionEntry[];
    expect(computeIdleGapMs(entries, now)).toBeNull();
  });

  it("falls back to the previous entry when the tail is this turn's fresh user message", () => {
    const now = Date.now();
    const entries = [
      messageEntry("user", now - 2 * 60 * MINUTE, "old-user"),
      messageEntry("assistant", now - 120 * MINUTE, "last-activity"),
      messageEntry("user", now - 5_000, "new-message"),
    ];
    expect(computeIdleGapMs(entries, now)).toBe(120 * MINUTE);
  });

  it("does not fall back when the tail is an old user message (resume after crash before reply)", () => {
    const now = Date.now();
    const entries = [
      messageEntry("assistant", now - 3 * MINUTE, "last-activity"),
      messageEntry("user", now - (3 * MINUTE - 5_000), "never-answered"),
    ];
    const gap = computeIdleGapMs(entries, now);
    expect(gap).not.toBeNull();
    expect(gap!).toBeGreaterThanOrEqual(3 * MINUTE - 6_000);
  });

  it("does not fall back when the tail is a fresh assistant message (previous turn just ended)", () => {
    const now = Date.now();
    const entries = [
      messageEntry("user", now - 2 * 60 * MINUTE, "old-user"),
      messageEntry("assistant", now - 4_000, "just-finished"),
    ];
    expect(computeIdleGapMs(entries, now)).toBeLessThanOrEqual(4_000);
  });

  it("self-heals after compaction: a fresh compaction entry is the activity marker", () => {
    const now = Date.now();
    const entries = [messageEntry("assistant", now - 90 * MINUTE, "pre-compaction"), compactionEntry(now - 3_000)];
    expect(computeIdleGapMs(entries, now)).toBeLessThanOrEqual(3_000);
  });

  it("uses the fresh user message itself when it is the only entry", () => {
    const now = Date.now();
    const entries = [messageEntry("user", now - 2_000, "only")];
    expect(computeIdleGapMs(entries, now)).toBeLessThanOrEqual(2_000);
  });

  it("tolerance boundary: user message older than the tolerance is used directly", () => {
    const now = Date.now();
    const entries = [
      messageEntry("assistant", now - 60 * MINUTE, "last-activity"),
      messageEntry("user", now - (CURRENT_TURN_TOLERANCE_MS + 10_000), "slightly-stale"),
    ];
    expect(computeIdleGapMs(entries, now)).toBe(CURRENT_TURN_TOLERANCE_MS + 10_000);
  });
});

describe("shouldIdleCompact", () => {
  const base = {
    gapMs: 60 * MINUTE,
    tokens: 150_000,
    contextWindow: 200_000,
    thresholdMinutes: 30,
  };

  it("fires when gap, threshold, and floor are all satisfied", () => {
    expect(shouldIdleCompact(base)).toBe(true);
  });

  it("never fires when the threshold is zero (disabled)", () => {
    expect(shouldIdleCompact({ ...base, thresholdMinutes: 0 })).toBe(false);
  });

  it("never fires when the threshold is negative", () => {
    expect(shouldIdleCompact({ ...base, thresholdMinutes: -5 })).toBe(false);
  });

  it("never fires when the gap is unknown", () => {
    expect(shouldIdleCompact({ ...base, gapMs: null })).toBe(false);
  });

  it("never fires below the 50% floor", () => {
    expect(shouldIdleCompact({ ...base, tokens: 99_999, contextWindow: 200_000 })).toBe(false);
  });

  it("fires at exactly the 50% floor", () => {
    expect(shouldIdleCompact({ ...base, tokens: 100_000, contextWindow: 200_000 })).toBe(true);
  });

  it("fires at exactly the threshold gap", () => {
    expect(shouldIdleCompact({ ...base, gapMs: 30 * MINUTE, thresholdMinutes: 30 })).toBe(true);
  });

  it("does not fire below the threshold gap", () => {
    expect(shouldIdleCompact({ ...base, gapMs: 29 * MINUTE, thresholdMinutes: 30 })).toBe(false);
  });

  it("never fires without a context window", () => {
    expect(shouldIdleCompact({ ...base, contextWindow: 0 })).toBe(false);
  });
});

describe("normalizeIdleCompactMinutes", () => {
  it("defaults to 0 when unset", () => {
    expect(normalizeIdleCompactMinutes(undefined)).toBe(0);
    expect(normalizeIdleCompactMinutes(null)).toBe(0);
  });

  it("passes through valid numbers", () => {
    expect(normalizeIdleCompactMinutes(45)).toBe(45);
    expect(normalizeIdleCompactMinutes(0)).toBe(0);
    expect(normalizeIdleCompactMinutes(0.5)).toBe(0.5);
  });

  it("parses numeric strings from a hand-edited config file", () => {
    expect(normalizeIdleCompactMinutes("45")).toBe(45);
  });

  it("rejects garbage values to 0", () => {
    expect(normalizeIdleCompactMinutes("abc")).toBe(0);
    expect(normalizeIdleCompactMinutes(Number.NaN)).toBe(0);
  });

  it("clamps negative values to 0", () => {
    expect(normalizeIdleCompactMinutes(-10)).toBe(0);
  });
});
