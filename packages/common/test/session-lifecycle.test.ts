import { describe, expect, test } from "vitest";
import { SessionLifecycle } from "../src/session-lifecycle.ts";

describe("SessionLifecycle", () => {
  test("isCurrent matches the captured generation before start", () => {
    const life = new SessionLifecycle();
    expect(life.isCurrent()).toBe(true);
  });

  test("stale generation is rejected after a new start", () => {
    const life = new SessionLifecycle();
    life.start();
    const gen = life.currentGeneration();
    life.start();
    expect(life.isCurrent(gen)).toBe(false);
    expect(life.isCurrent(life.currentGeneration())).toBe(true);
  });

  test("shutdown rejects all checks", () => {
    const life = new SessionLifecycle();
    life.start();
    const gen = life.currentGeneration();
    life.shutdown();
    expect(life.isCurrent(gen)).toBe(false);
    expect(life.isCurrent()).toBe(false);
  });

  test("start clears a prior shutdown", () => {
    const life = new SessionLifecycle();
    life.shutdown();
    life.start();
    expect(life.isCurrent()).toBe(true);
  });
});
