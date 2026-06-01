import { describe, expect, test } from "vitest";
import {
  truncateDisplay,
  formatTokenUsageArrows,
  formatTokenUsageSummaryLine,
  usagePercentStressLevel,
} from "./format.ts";

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
    expect(formatTokenUsageSummaryLine(1, 2, 33.7)).toBe(
      "Tokens: ↑1 ↓2 · context 34%",
    );
    expect(formatTokenUsageSummaryLine(1, 2, null)).toBe("Tokens: ↑1 ↓2");
  });
});
