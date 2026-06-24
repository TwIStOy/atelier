import { describe, expect, test, vi } from "vitest";
import { DEFAULT_SPEED_CONFIG, estimateTokensFromDelta, type SpeedConfig, TokenSpeedEngine } from "../src/speed-engine.ts";

const CONFIG: SpeedConfig = {
  ...DEFAULT_SPEED_CONFIG,
  useProviderTokens: false,
};

describe("estimateTokensFromDelta", () => {
  test("returns 0 for empty text", () => {
    expect(estimateTokensFromDelta("", "estimate")).toBe(0);
    expect(estimateTokensFromDelta("", "direct")).toBe(0);
  });

  test("counts one token per delta in direct mode", () => {
    expect(estimateTokensFromDelta("hello world", "direct")).toBe(1);
  });

  test("estimates tokens from words and punctuation", () => {
    expect(estimateTokensFromDelta("hello, world!", "estimate")).toBe(4);
  });
});

describe("TokenSpeedEngine", () => {
  test("is idle before start", () => {
    const engine = new TokenSpeedEngine(CONFIG);
    expect(engine.isStreaming).toBe(false);
    expect(engine.tokenCount).toBe(0);
    expect(engine.elapsedMs).toBe(0);
    expect(engine.avgTokS).toBe(0);
  });

  test("suppresses display speed before the reliable-duration warmup", () => {
    vi.useFakeTimers();
    const engine = new TokenSpeedEngine(CONFIG);
    engine.start();

    vi.advanceTimersByTime(500);
    engine.recordTokens(50);

    expect(engine.rawTokS).toBe(100);
    expect(engine.tokS).toBe(0);
    vi.useRealTimers();
  });

  test("uses a sliding window after warmup", () => {
    vi.useFakeTimers();
    const engine = new TokenSpeedEngine(CONFIG);
    engine.start();

    vi.advanceTimersByTime(1000);
    engine.recordTokens(10);
    vi.advanceTimersByTime(500);
    engine.recordTokens(5);

    expect(engine.tokS).toBe(30);
    vi.useRealTimers();
  });

  test("falls back to avgTokS while streaming before a full window", () => {
    vi.useFakeTimers();
    const engine = new TokenSpeedEngine(CONFIG);
    engine.start();
    vi.advanceTimersByTime(500);
    engine.recordTokens(5);

    expect(engine.rawTokS).toBe(engine.avgTokS);
    vi.useRealTimers();
  });

  test("records incremental provider usage when enabled", () => {
    const engine = new TokenSpeedEngine({ ...CONFIG, useProviderTokens: true });
    engine.start();
    engine.recordDelta("ignored", 5);
    engine.recordDelta("ignored", 12);

    expect(engine.tokenCount).toBe(12);
  });

  test("reconciles to authoritative usage at message end", () => {
    vi.useFakeTimers();
    const engine = new TokenSpeedEngine(CONFIG);
    engine.start();
    vi.advanceTimersByTime(1000);
    engine.recordTokens(10);
    engine.reconcileTotal(42);
    const avgTokS = engine.avgTokS;
    engine.stop();

    expect(engine.tokenCount).toBe(42);
    expect(avgTokS).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  test("avoids burst spikes from large single deltas", () => {
    vi.useFakeTimers();
    const engine = new TokenSpeedEngine({
      ...CONFIG,
      countStrategy: "estimate",
    });
    engine.start();

    vi.advanceTimersByTime(1000);
    engine.recordDelta("word ".repeat(2000));
    vi.advanceTimersByTime(10);

    expect(engine.rawTokS).toBe(200000);
    expect(engine.tokS).toBe(0);
    vi.useRealTimers();
  });

  test("ignores recordDelta/recordTokens when not streaming", () => {
    const engine = new TokenSpeedEngine(CONFIG);
    engine.recordTokens(100);
    engine.recordDelta("hello", 10);
    expect(engine.tokenCount).toBe(0);
  });

  test("stops streaming on stop()", () => {
    vi.useFakeTimers();
    const engine = new TokenSpeedEngine(CONFIG);
    engine.start();
    vi.advanceTimersByTime(1000);
    engine.recordTokens(10);
    engine.stop();

    expect(engine.isStreaming).toBe(false);
    expect(engine.rawTokS).toBe(engine.avgTokS);
    vi.useRealTimers();
  });

  test("updateConfig changes sanitization thresholds live", () => {
    const engine = new TokenSpeedEngine(CONFIG);
    engine.updateConfig({ ...CONFIG, maxDisplayTokS: 10 });

    expect(engine.sanitizeTokS(50, 2000)).toBeNull();
    expect(engine.sanitizeTokS(5, 2000)).toBe(5);
  });
});
