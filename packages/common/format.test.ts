import { describe, expect, test } from "vitest";
import { truncateDisplay } from "./format.ts";

describe("truncateDisplay", () => {
  test("leaves short strings unchanged", () => {
    expect(truncateDisplay("abc", 10)).toBe("abc");
  });

  test("truncates with ellipsis within maxLen", () => {
    const s = "a".repeat(100);
    const out = truncateDisplay(s, 10);
    expect(out.length).toBe(10);
    expect(out.endsWith("…")).toBe(true);
  });
});
