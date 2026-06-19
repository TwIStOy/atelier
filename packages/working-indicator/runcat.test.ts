import { describe, expect, test } from "vitest";
import {
  clampInterval,
  DEFAULT_RUNCAT_SPEED_CONFIG,
  type RuncatSpeedConfig,
  runcatSpeedIntervalMs,
  shouldUpdateInterval,
} from "./runcat.ts";

const CONFIG: RuncatSpeedConfig = DEFAULT_RUNCAT_SPEED_CONFIG;

describe("runcatSpeedIntervalMs", () => {
  test("falls back to default interval when speed is null", () => {
    expect(runcatSpeedIntervalMs(null)).toBe(CONFIG.defaultIntervalMs);
  });

  test("falls back to default interval when speed is not a positive number", () => {
    expect(runcatSpeedIntervalMs(0)).toBe(CONFIG.defaultIntervalMs);
    expect(runcatSpeedIntervalMs(-5)).toBe(CONFIG.defaultIntervalMs);
    expect(runcatSpeedIntervalMs(Number.NaN)).toBe(CONFIG.defaultIntervalMs);
    expect(runcatSpeedIntervalMs(Number.POSITIVE_INFINITY)).toBe(
      CONFIG.defaultIntervalMs,
    );
  });

  test("clamps very fast speed to the minimum interval", () => {
    expect(runcatSpeedIntervalMs(1000)).toBe(CONFIG.minIntervalMs);
  });

  test("clamps very slow speed to the maximum interval", () => {
    expect(runcatSpeedIntervalMs(1)).toBe(CONFIG.maxIntervalMs);
  });

  test("scales interval inversely with speed in the usable band", () => {
    expect(runcatSpeedIntervalMs(40)).toBe(Math.round(CONFIG.scale / 40));
    expect(runcatSpeedIntervalMs(60)).toBe(Math.round(CONFIG.scale / 60));
    expect(runcatSpeedIntervalMs(120)).toBe(Math.round(CONFIG.scale / 120));
  });

  test("higher speed yields a smaller interval (cat runs faster)", () => {
    const slow = runcatSpeedIntervalMs(30);
    const fast = runcatSpeedIntervalMs(90);
    expect(fast).toBeLessThan(slow);
  });

  test("respects a custom config with inverted min/max via clampInterval", () => {
    const inverted: RuncatSpeedConfig = {
      ...CONFIG,
      minIntervalMs: 250,
      maxIntervalMs: 50,
    };
    expect(runcatSpeedIntervalMs(1, inverted)).toBe(250);
    expect(runcatSpeedIntervalMs(1000, inverted)).toBe(50);
  });
});

describe("clampInterval", () => {
  test("keeps values inside the band unchanged", () => {
    expect(clampInterval(120, CONFIG)).toBe(120);
  });

  test("clamps to the lower bound", () => {
    expect(clampInterval(10, CONFIG)).toBe(CONFIG.minIntervalMs);
  });

  test("clamps to the upper bound", () => {
    expect(clampInterval(500, CONFIG)).toBe(CONFIG.maxIntervalMs);
  });
});

describe("shouldUpdateInterval", () => {
  test("returns false when the delta is below the threshold", () => {
    expect(shouldUpdateInterval(100, 105)).toBe(false);
    expect(shouldUpdateInterval(100, 109)).toBe(false);
  });

  test("returns true when the delta meets the threshold", () => {
    expect(shouldUpdateInterval(100, 110)).toBe(true);
    expect(shouldUpdateInterval(110, 100)).toBe(true);
  });
});
