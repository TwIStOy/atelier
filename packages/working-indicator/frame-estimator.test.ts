import { describe, expect, test } from "vitest";
import { FrameEstimator } from "./frame-estimator.ts";

const FRAMES = ["a", "b", "c", "d"];

describe("FrameEstimator", () => {
  test("reports null before any reset", () => {
    const e = new FrameEstimator();
    expect(e.isKnown()).toBe(false);
    expect(e.estimate()).toBeNull();
  });

  test("clear returns to unknown state", () => {
    const e = new FrameEstimator({ now: () => 0 });
    e.reset(FRAMES, 100);
    e.clear();
    expect(e.isKnown()).toBe(false);
    expect(e.estimate()).toBeNull();
  });

  test("index 0 at the reset moment", () => {
    const e = new FrameEstimator({ now: () => 0 });
    e.reset(FRAMES, 100);
    expect(e.estimate()).toEqual({ index: 0, frame: "a" });
  });

  test("advances by one frame per intervalMs", () => {
    const e = new FrameEstimator({ now: () => 0 });
    e.reset(FRAMES, 100);
    expect(e.estimate(0)!.index).toBe(0);
    expect(e.estimate(99)!.index).toBe(0);
    expect(e.estimate(100)!.index).toBe(1);
    expect(e.estimate(199)!.index).toBe(1);
    expect(e.estimate(200)!.index).toBe(2);
    expect(e.estimate(300)!.index).toBe(3);
  });

  test("wraps around modulo frames.length", () => {
    const e = new FrameEstimator({ now: () => 0 });
    e.reset(FRAMES, 100);
    expect(e.estimate(400)!.index).toBe(0);
    expect(e.estimate(400)!.frame).toBe("a");
    expect(e.estimate(700)!.index).toBe(3);
  });

  test("reset restarts the clock from the new base", () => {
    const e = new FrameEstimator({ now: () => 1000 });
    e.reset(FRAMES, 100);
    expect(e.estimate(1000)!.index).toBe(0);
    expect(e.estimate(1050)!.index).toBe(0);
    e.reset(FRAMES, 100);
    expect(e.estimate(1050)!.index).toBe(0);
    expect(e.estimate(1100)!.index).toBe(1);
  });

  test("zero interval pins to frame 0 instead of dividing by zero", () => {
    const e = new FrameEstimator({ now: () => 0 });
    e.reset(["x", "y"], 0);
    expect(e.isKnown()).toBe(true);
    expect(e.estimate(12345)).toEqual({ index: 0, frame: "x" });
  });

  test("empty frames report null even after reset", () => {
    const e = new FrameEstimator({ now: () => 0 });
    e.reset([], 100);
    expect(e.estimate()).toBeNull();
  });
});

describe("FrameEstimator.isCyclicRotation", () => {
  test("false before any reset (no current frames)", () => {
    const e = new FrameEstimator();
    expect(e.isCyclicRotation(["a", "b", "c"])).toBe(false);
  });

  test("false after clear", () => {
    const e = new FrameEstimator({ now: () => 0 });
    e.reset(["a", "b", "c"], 100);
    e.clear();
    expect(e.isCyclicRotation(["a", "b", "c"])).toBe(false);
  });

  test("false when lengths differ", () => {
    const e = new FrameEstimator({ now: () => 0 });
    e.reset(["a", "b", "c"], 100);
    expect(e.isCyclicRotation(["a", "b"])).toBe(false);
    expect(e.isCyclicRotation(["a", "b", "c", "d"])).toBe(false);
  });

  test("false when content differs entirely", () => {
    const e = new FrameEstimator({ now: () => 0 });
    e.reset(["a", "b", "c"], 100);
    expect(e.isCyclicRotation(["x", "y", "z"])).toBe(false);
  });

  test("true for the same array", () => {
    const e = new FrameEstimator({ now: () => 0 });
    const frames = ["a", "b", "c"];
    e.reset(frames, 100);
    expect(e.isCyclicRotation(frames)).toBe(true);
  });

  test("true for any rotation of the current frames", () => {
    const e = new FrameEstimator({ now: () => 0 });
    e.reset(["a", "b", "c", "d"], 100);
    expect(e.isCyclicRotation(["a", "b", "c", "d"])).toBe(true);
    expect(e.isCyclicRotation(["b", "c", "d", "a"])).toBe(true);
    expect(e.isCyclicRotation(["c", "d", "a", "b"])).toBe(true);
    expect(e.isCyclicRotation(["d", "a", "b", "c"])).toBe(true);
  });

  test("handles repeated elements correctly", () => {
    const e = new FrameEstimator({ now: () => 0 });
    e.reset(["a", "b", "a", "b"], 100);
    expect(e.isCyclicRotation(["a", "b", "a", "b"])).toBe(true);
    expect(e.isCyclicRotation(["b", "a", "b", "a"])).toBe(true);
    expect(e.isCyclicRotation(["a", "b", "b", "a"])).toBe(false);
  });
});

describe("FrameEstimator.rotatedForReset", () => {
  test("returns original frames when no prior state", () => {
    let t = 0;
    const e = new FrameEstimator({ now: () => t });
    expect(e.rotatedForReset(["a", "b", "c"], 100)).toEqual(["a", "b", "c"]);
  });

  test("returns original frames after clear", () => {
    let t = 0;
    const e = new FrameEstimator({ now: () => t });
    e.reset(["a", "b", "c"], 100);
    e.clear();
    expect(e.rotatedForReset(["a", "b", "c"], 100)).toEqual(["a", "b", "c"]);
  });

  test("returns original frames when content differs (key change)", () => {
    let t = 0;
    const e = new FrameEstimator({ now: () => t });
    e.reset(["a", "b", "c", "d"], 100);
    t = 200;
    expect(e.rotatedForReset(["w", "x", "y", "z"], 100)).toEqual([
      "w",
      "x",
      "y",
      "z",
    ]);
  });

  test("rotates so current frame lands at index 0 (same frames, advanced)", () => {
    let t = 0;
    const e = new FrameEstimator({ now: () => t });
    e.reset(["a", "b", "c", "d"], 100);
    t = 200;
    expect(e.rotatedForReset(["a", "b", "c", "d"], 100)).toEqual([
      "c",
      "d",
      "a",
      "b",
    ]);
  });

  test("rotates by elapsed index even with a new interval (runcat refresh)", () => {
    let t = 0;
    const e = new FrameEstimator({ now: () => t });
    e.reset(["a", "b", "c", "d"], 100);
    t = 350;
    expect(e.rotatedForReset(["a", "b", "c", "d"], 250)).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
  });

  test("no rotation when current index is 0", () => {
    let t = 0;
    const e = new FrameEstimator({ now: () => t });
    e.reset(["a", "b", "c", "d"], 100);
    t = 0;
    expect(e.rotatedForReset(["a", "b", "c", "d"], 100)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  test("wraps rotation modulo length (full cycle back to 0)", () => {
    let t = 0;
    const e = new FrameEstimator({ now: () => t });
    e.reset(["a", "b", "c", "d"], 100);
    t = 400;
    expect(e.rotatedForReset(["a", "b", "c", "d"], 50)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});
