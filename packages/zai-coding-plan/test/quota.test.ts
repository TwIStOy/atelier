import { describe, expect, test } from "vitest";
import { buildRawUsage, describeRawLimit } from "../src/quota.ts";

const QUOTA = {
  limits: [
    {
      type: "TIME_LIMIT",
      unit: 5,
      number: 1,
      usage: 4000,
      currentValue: 278,
      remaining: 3722,
      percentage: 6,
      nextResetTime: 1782804496992,
      usageDetails: [
        { modelCode: "search-prime", usage: 98 },
        { modelCode: "web-reader", usage: 180 },
        { modelCode: "zread", usage: 0 },
      ],
    },
    {
      type: "TOKENS_LIMIT",
      unit: 3,
      number: 5,
      percentage: 1,
      nextResetTime: 1782222112875,
    },
    {
      type: "TOKENS_LIMIT",
      unit: 6,
      number: 1,
      percentage: 10,
      nextResetTime: 1782718096997,
    },
  ],
  level: "max",
} as const;

const MODEL = {
  totalUsage: {
    totalModelCallCount: 732,
    totalTokensUsage: 44984926,
    modelSummaryList: [{ modelName: "GLM-5.2", totalTokens: 51197713, sortOrder: 1 }],
  },
} as const;

const TOOL = {
  totalUsage: {
    totalNetworkSearchCount: 1,
    totalWebReadMcpCount: 4,
    totalZreadMcpCount: 0,
    totalSearchMcpCount: 5,
    toolSummaryList: [
      {
        toolCode: "web-reader",
        toolName: "网页读取 MCP",
        totalUsageCount: 4,
        sortOrder: 1,
      },
      {
        toolCode: "search-prime",
        toolName: "联网搜索 MCP",
        totalUsageCount: 1,
        sortOrder: 2,
      },
    ],
  },
} as const;

describe("describeRawLimit", () => {
  test("TIME_LIMIT unit=5 number=1 -> tool_calls / monthly", () => {
    expect(describeRawLimit({ type: "TIME_LIMIT", unit: 5, number: 1 })).toEqual({
      kind: "tool_calls",
      period: "monthly",
    });
  });

  test("TOKENS_LIMIT unit=3 number=5 -> tokens / 5h", () => {
    expect(describeRawLimit({ type: "TOKENS_LIMIT", unit: 3, number: 5 })).toEqual({ kind: "tokens", period: "5h" });
  });

  test("TOKENS_LIMIT unit=6 number=1 -> tokens / weekly", () => {
    expect(describeRawLimit({ type: "TOKENS_LIMIT", unit: 6, number: 1 })).toEqual({
      kind: "tokens",
      period: "weekly",
    });
  });

  test("unknown TIME_LIMIT combination falls back to tool_calls / monthly", () => {
    expect(describeRawLimit({ type: "TIME_LIMIT", unit: 9, number: 9 })).toEqual({
      kind: "tool_calls",
      period: "monthly",
    });
  });

  test("unknown TOKENS_LIMIT combination returns null", () => {
    expect(describeRawLimit({ type: "TOKENS_LIMIT", unit: 9, number: 9 })).toBeNull();
  });

  test("missing fields return null", () => {
    expect(describeRawLimit({ type: "TOKENS_LIMIT" })).toBeNull();
    expect(describeRawLimit({})).toBeNull();
  });
});

describe("buildRawUsage", () => {
  const raw = buildRawUsage(
    QUOTA as Record<string, unknown>,
    MODEL as Record<string, unknown>,
    TOOL as Record<string, unknown>,
  );

  test("carries the plan level", () => {
    expect(raw?.level).toBe("max");
  });

  test("maps all three windows with correct kind/period/reset time", () => {
    expect(raw?.windows).toHaveLength(3);
    const [toolWin, fiveHour, weekly] = raw!.windows;
    expect(toolWin.kind).toBe("tool_calls");
    expect(toolWin.period).toBe("monthly");
    expect(toolWin.usedPercentage).toBe(6);
    expect(toolWin.nextResetTime).toBe(1782804496992);
    expect(fiveHour.kind).toBe("tokens");
    expect(fiveHour.period).toBe("5h");
    expect(fiveHour.nextResetTime).toBe(1782222112875);
    expect(weekly.kind).toBe("tokens");
    expect(weekly.period).toBe("weekly");
    expect(weekly.nextResetTime).toBe(1782718096997);
  });

  test("captures tool-call window numeric usage + details", () => {
    const toolWin = raw!.windows[0];
    expect(toolWin.usage).toBe(4000);
    expect(toolWin.limit).toBe(278);
    expect(toolWin.remaining).toBe(3722);
    expect(toolWin.details).toEqual([
      { modelCode: "search-prime", usage: 98 },
      { modelCode: "web-reader", usage: 180 },
      { modelCode: "zread", usage: 0 },
    ]);
  });

  test("aggregates model totals", () => {
    expect(raw?.modelTotals?.totalTokensUsage).toBe(44984926);
    expect(raw?.modelTotals?.totalModelCallCount).toBe(732);
    expect(raw?.modelTotals?.modelSummaryList).toEqual([{ modelName: "GLM-5.2", totalTokens: 51197713 }]);
  });

  test("aggregates tool totals", () => {
    expect(raw?.toolTotals?.totalNetworkSearchCount).toBe(1);
    expect(raw?.toolTotals?.totalWebReadMcpCount).toBe(4);
    expect(raw?.toolTotals?.totalZreadMcpCount).toBe(0);
    expect(raw?.toolTotals?.toolSummaryList).toHaveLength(2);
    expect(raw?.toolTotals?.toolSummaryList?.[0]).toEqual({
      toolCode: "web-reader",
      toolName: "网页读取 MCP",
      totalUsageCount: 4,
    });
  });

  test("returns null when everything is empty", () => {
    expect(buildRawUsage(null, null, null)).toBeNull();
    expect(buildRawUsage({ limits: [] }, { totalUsage: {} }, { totalUsage: {} })).toBeNull();
  });
});
