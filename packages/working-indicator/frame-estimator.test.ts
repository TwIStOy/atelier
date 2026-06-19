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
