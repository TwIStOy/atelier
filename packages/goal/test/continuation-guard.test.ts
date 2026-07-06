import { describe, expect, it } from "vitest";
import { createContinuationGuard } from "../src/goal/continuation-guard.ts";

describe("continuation guard", () => {
  it("allows queueing when nothing is pending", () => {
    const guard = createContinuationGuard();
    expect(guard.shouldQueue("g1")).toBe(true);
    expect(guard.queuedFor()).toBeNull();
  });

  it("blocks re-queueing for the same goal while pending", () => {
    const guard = createContinuationGuard();
    guard.markQueued("g1");
    expect(guard.shouldQueue("g1")).toBe(false);
    expect(guard.queuedFor()).toBe("g1");
  });

  it("allows a different goal id while one is pending (transitions clear first)", () => {
    const guard = createContinuationGuard();
    guard.markQueued("g1");
    expect(guard.shouldQueue("g2")).toBe(true);
  });

  it("allows queueing again after clear (the queued turn was consumed)", () => {
    const guard = createContinuationGuard();
    guard.markQueued("g1");
    guard.clear();
    expect(guard.shouldQueue("g1")).toBe(true);
    expect(guard.queuedFor()).toBeNull();
  });
});
