import { describe, expect, test } from "vitest";
import { validateObjective, validateTokenBudget } from "./validation.ts";

describe("validateObjective", () => {
  test("trims and accepts valid objective", () => {
    expect(validateObjective("  ship feature  ")).toBe("ship feature");
  });

  test("rejects empty objective", () => {
    expect(() => validateObjective("   ")).toThrow();
  });

  test("rejects too-long objective", () => {
    expect(() => validateObjective("a".repeat(4001))).toThrow();
  });
});

describe("validateTokenBudget", () => {
  test("accepts undefined", () => {
    expect(validateTokenBudget(undefined)).toBeUndefined();
  });

  test("accepts positive integer", () => {
    expect(validateTokenBudget(12)).toBe(12);
  });

  test("rejects invalid values", () => {
    expect(() => validateTokenBudget(0)).toThrow();
    expect(() => validateTokenBudget(1.2)).toThrow();
    expect(() => validateTokenBudget("10")).toThrow();
  });
});
