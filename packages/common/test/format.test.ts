import { describe, expect, test } from "vitest";
import {
  fitSegmentsByPriority,
  formatTokenUsageArrows,
  formatTokenUsageSummaryLine,
  truncateDisplay,
  usagePercentStressLevel,
} from "../src/format.ts";

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

describe("formatTokenUsageArrows", () => {
  test("formats input and output", () => {
    expect(formatTokenUsageArrows(0, 0)).toBe("↑0 ↓0");
    expect(formatTokenUsageArrows(1500, 2_000_000)).toBe("↑1.5k ↓2.0M");
  });
});

describe("usagePercentStressLevel", () => {
  test("buckets by shared thresholds", () => {
    expect(usagePercentStressLevel(0)).toBe("low");
    expect(usagePercentStressLevel(50)).toBe("low");
    expect(usagePercentStressLevel(51)).toBe("medium");
    expect(usagePercentStressLevel(80)).toBe("medium");
    expect(usagePercentStressLevel(81)).toBe("high");
  });
});

describe("formatTokenUsageSummaryLine", () => {
  test("includes optional context", () => {
    expect(formatTokenUsageSummaryLine(1, 2)).toBe("Tokens: ↑1 ↓2");
    expect(formatTokenUsageSummaryLine(1, 2, 33.7)).toBe("Tokens: ↑1 ↓2 · context 34%");
    expect(formatTokenUsageSummaryLine(1, 2, null)).toBe("Tokens: ↑1 ↓2");
  });
});

describe("fitSegmentsByPriority", () => {
  const seg = (text: string, priority: number) => ({ text, priority });

  test("joins all segments when they fit", () => {
    expect(fitSegmentsByPriority([seg("a", 1), seg("bb", 2)], 10)).toBe("a | bb");
  });

  test("drops lowest-priority segment first to fit", () => {
    // full "aa | bbb | c" = 12 -> drop "c" -> "aa | bbb" = 8, fits at 8.
    const out = fitSegmentsByPriority([seg("aa", 2), seg("bbb", 1), seg("c", 0)], 8);
    expect(out).toBe("aa | bbb");
  });

  test("truncates the highest-priority survivor when nothing else fits", () => {
    const out = fitSegmentsByPriority([seg("aaaaaa", 2), seg("b", 0)], 4);
    expect(out).toBe("aaa…");
  });

  test("preserves input display order after dropping", () => {
    // full = 14 -> drop "low" -> "hi | mid" = 8, fits at 8, keeps input order.
    const out = fitSegmentsByPriority([seg("low", 0), seg("hi", 2), seg("mid", 1)], 8);
    expect(out).toBe("hi | mid");
  });

  test("uses injected measure and truncate", () => {
    const out = fitSegmentsByPriority([seg("XYZ", 1)], 2, {
      measure: () => 10,
      truncate: (text, max) => `${text.slice(0, max)}!`,
    });
    expect(out).toBe("XY!");
  });

  test("returns empty for zero width or no segments", () => {
    expect(fitSegmentsByPriority([], 10)).toBe("");
    expect(fitSegmentsByPriority([seg("a", 1)], 0)).toBe("");
  });
});
