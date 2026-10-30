import { describe, expect, test } from "vitest";
import { flattenToSingleLine } from "../src/history.ts";

describe("flattenToSingleLine", () => {
  test("joins multi-line text with single spaces", () => {
    expect(flattenToSingleLine("def foo():\n    return 1")).toBe("def foo(): return 1");
  });

  test("collapses runs of whitespace including newlines and indentation", () => {
    expect(flattenToSingleLine("a\n\n   b\t\n  c")).toBe("a b c");
  });

  test("trims leading and trailing whitespace", () => {
    expect(flattenToSingleLine("  \n hello world \n ")).toBe("hello world");
  });

  test("leaves single-line text unchanged", () => {
    expect(flattenToSingleLine("already one line")).toBe("already one line");
  });

  test("returns empty string for whitespace-only input", () => {
    expect(flattenToSingleLine("   \n\t  ")).toBe("");
  });

  test("preserves internal single spaces", () => {
    expect(flattenToSingleLine("one two three")).toBe("one two three");
  });
});
