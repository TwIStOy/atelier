import { describe, expect, test } from "vitest";
import {
  clampInterval,
  DEFAULT_RUNCAT_SPEED_CONFIG,
  type RuncatSpeedConfig,
  quantizeInterval,
  runcatSpeedIntervalMs,
  shouldRefreshRuncatInterval,
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

describe("quantizeInterval", () => {
  const config = DEFAULT_RUNCAT_SPEED_CONFIG;

  test("snaps to the nearest step across the band (50/90/130/170/210/250)", () => {
    expect(quantizeInterval(50, config)).toBe(50);
    expect(quantizeInterval(69, config)).toBe(50);
    expect(quantizeInterval(70, config)).toBe(90);
    expect(quantizeInterval(110, config)).toBe(130);
    expect(quantizeInterval(150, config)).toBe(170);
    expect(quantizeInterval(180, config)).toBe(170);
    expect(quantizeInterval(190, config)).toBe(210);
    expect(quantizeInterval(229, config)).toBe(210);
    expect(quantizeInterval(230, config)).toBe(250);
    expect(quantizeInterval(250, config)).toBe(250);
  });

  test("clamps out-of-range values before snapping", () => {
    expect(quantizeInterval(10, config)).toBe(50);
    expect(quantizeInterval(500, config)).toBe(250);
  });

  test("collapses to the floor when steps is 1", () => {
    const single: RuncatSpeedConfig = { ...config, quantizeSteps: 1 };
    expect(quantizeInterval(150, single)).toBe(50);
  });

  test("returns the floor when steps is 2 (only floor and ceiling)", () => {
    const pair: RuncatSpeedConfig = { ...config, quantizeSteps: 2 };
    expect(quantizeInterval(149, pair)).toBe(50);
    expect(quantizeInterval(150, pair)).toBe(250);
    expect(quantizeInterval(250, pair)).toBe(250);
  });

  test("keeps small jitter inside one bucket stable", () => {
    expect(quantizeInterval(168, config)).toBe(quantizeInterval(172, config));
    expect(quantizeInterval(168, config)).toBe(170);
  });
});

describe("shouldRefreshRuncatInterval", () => {
  test("returns true while not thinking so the interval tracks live speed", () => {
    expect(shouldRefreshRuncatInterval(false)).toBe(true);
  });

  test("returns false while thinking so the spinner freezes on default", () => {
    expect(shouldRefreshRuncatInterval(true)).toBe(false);
  });
});
