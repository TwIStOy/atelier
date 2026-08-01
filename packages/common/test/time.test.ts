import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveNow } from "../src/time.ts";

describe("resolveNow", () => {
  const FIXED = new Date(Date.UTC(2024, 0, 5, 9, 0, 0));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the Date instance unchanged when given one", () => {
    expect(resolveNow(FIXED)).toBe(FIXED);
  });

  it("calls a clock thunk when given a function", () => {
    const thunk = vi.fn(() => FIXED);
    expect(resolveNow(thunk)).toBe(FIXED);
    expect(thunk).toHaveBeenCalledTimes(1);
  });

  it("falls back to the current wall-clock time when undefined", () => {
    expect(resolveNow(undefined)).toEqual(FIXED);
  });

  it("returns the current time when omitted (no argument)", () => {
    expect(resolveNow()).toEqual(FIXED);
  });
});
