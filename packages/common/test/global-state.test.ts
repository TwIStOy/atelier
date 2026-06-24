import { describe, expect, test } from "vitest";
import { clearGlobalState, getGlobalState } from "../src/global-state.ts";

describe("getGlobalState", () => {
  test("returns init value on first access", () => {
    const key = "test-global-state-init";
    const state = getGlobalState(key, () => ({ count: 42 }));
    expect(state).toEqual({ count: 42 });
    clearGlobalState(key);
  });

  test("returns same reference on subsequent calls", () => {
    const key = "test-global-state-ref";
    const first = getGlobalState(key, () => ({ items: [] as number[] }));
    first.items.push(1);
    const second = getGlobalState(key, () => ({ items: [] as number[] }));
    expect(second).toBe(first);
    expect(second.items).toEqual([1]);
    clearGlobalState(key);
  });
});

describe("clearGlobalState", () => {
  test("removes the slot and returns true", () => {
    const key = "test-global-state-clear";
    getGlobalState(key, () => "hello");
    expect(clearGlobalState(key)).toBe(true);
    expect(clearGlobalState(key)).toBe(false);
  });

  test("returns false when slot does not exist", () => {
    expect(clearGlobalState("test-global-state-missing")).toBe(false);
  });
});
