import { describe, expect, test, vi } from "vitest";
import { DEFAULT_SPEED_CONFIG, type SpeedConfig } from "../src/speed-engine.ts";
import { SpeedTracker } from "../src/speed-tracker.ts";

const CONFIG: SpeedConfig = {
  ...DEFAULT_SPEED_CONFIG,
  useProviderTokens: false,
};

describe("SpeedTracker", () => {
  test("defaults to DEFAULT_SPEED_CONFIG when no config provided", () => {
    const tracker = new SpeedTracker();
    expect(tracker.isStreaming).toBe(false);
    expect(tracker.lastTokS).toBeNull();
    expect(tracker.sessionAvgTokS()).toBeNull();
  });

  test("records reliable completed messages into the session average", () => {
    vi.useFakeTimers();
    const tracker = new SpeedTracker(CONFIG);
    tracker.startMessage();

    vi.advanceTimersByTime(1000);
    tracker.recordDelta("hello world");
    const completed = tracker.finishMessage(20, "stop");

    expect(completed?.outputTokens).toBe(20);
    expect(completed?.tokS).toBe(20);
    expect(tracker.lastTokS).toBe(20);
    expect(tracker.sessionAvgTokS()).toBe(20);
    vi.useRealTimers();
  });

  test("keeps unreliable or aborted messages out of the session average", () => {
    vi.useFakeTimers();
    const tracker = new SpeedTracker(CONFIG);

    tracker.startMessage();
    vi.advanceTimersByTime(1000);
    tracker.recordDelta("hello world");
    tracker.finishMessage(20, "aborted");

    expect(tracker.lastTokS).toBe(20);
    expect(tracker.sessionAvgTokS()).toBeNull();
    vi.useRealTimers();
  });

  test("keeps errored messages out of the session average", () => {
    vi.useFakeTimers();
    const tracker = new SpeedTracker(CONFIG);

    tracker.startMessage();
    vi.advanceTimersByTime(1000);
    tracker.recordDelta("hello world");
    const completed = tracker.finishMessage(20, "error");

    expect(completed?.tokS).toBe(20);
    expect(tracker.sessionAvgTokS()).toBeNull();
    vi.useRealTimers();
  });

  test("accumulates multiple successful messages into session average", () => {
    vi.useFakeTimers();
    const tracker = new SpeedTracker(CONFIG);

    tracker.startMessage();
    vi.advanceTimersByTime(1000);
    tracker.recordDelta("hello world");
    tracker.finishMessage(20, "stop");

    tracker.startMessage();
    vi.advanceTimersByTime(1000);
    tracker.recordDelta("hello again world");
    tracker.finishMessage(40, "stop");

    expect(tracker.sessionAvgTokS()).toBe(30);
    vi.useRealTimers();
  });

  test("liveTokS falls back to last stable when engine reports zero", () => {
    vi.useFakeTimers();
    const tracker = new SpeedTracker(CONFIG);

    tracker.startMessage();
    vi.advanceTimersByTime(1000);
    tracker.recordDelta("hello world");
    tracker.finishMessage(20, "stop");
    expect(tracker.lastTokS).toBe(20);

    tracker.startMessage();
    expect(tracker.liveTokS()).toBe(20);
    vi.useRealTimers();
  });

  test("finishMessage returns null when not streaming", () => {
    const tracker = new SpeedTracker(CONFIG);
    expect(tracker.finishMessage(20, "stop")).toBeNull();
  });

  test("resetSession clears accumulated session stats", () => {
    vi.useFakeTimers();
    const tracker = new SpeedTracker(CONFIG);
    tracker.startMessage();
    vi.advanceTimersByTime(1000);
    tracker.recordDelta("hello world");
    tracker.finishMessage(20, "stop");
    expect(tracker.sessionAvgTokS()).toBe(20);

    tracker.resetSession();
    expect(tracker.sessionAvgTokS()).toBeNull();
    vi.useRealTimers();
  });

  test("stopMessage stops a streaming engine", () => {
    const tracker = new SpeedTracker(CONFIG);
    tracker.startMessage();
    expect(tracker.isStreaming).toBe(true);
    tracker.stopMessage();
    expect(tracker.isStreaming).toBe(false);
  });
});
