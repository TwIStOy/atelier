import { describe, expect, test } from "vitest";
import {
  formatGoalElapsedSeconds,
  formatGoalForTool,
  formatGoalToolResponse,
  formatTokensCompact,
} from "./format.ts";
import type { Goal } from "./types.ts";

describe("formatGoalElapsedSeconds", () => {
  test("formats across ranges", () => {
    expect(formatGoalElapsedSeconds(30)).toBe("30s");
    expect(formatGoalElapsedSeconds(90)).toBe("1m");
    expect(formatGoalElapsedSeconds(3660)).toBe("1h 1m");
    expect(formatGoalElapsedSeconds(90000)).toBe("1d 1h");
  });
});

describe("formatTokensCompact", () => {
  test("formats token counts", () => {
    expect(formatTokensCompact(999)).toBe("999");
    expect(formatTokensCompact(1_200)).toBe("1.2K");
    expect(formatTokensCompact(1_500_000)).toBe("1.5M");
  });
});

describe("goal output formatters", () => {
  const goal: Goal = {
    id: "g1",
    threadId: "t1",
    objective: "ship goal",
    status: "active",
    tokenBudget: 1000,
    tokensUsed: 250,
    timeUsedSeconds: 80,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastStartedAt: "2026-01-01T00:00:00.000Z",
  };

  test("formats text for command feedback", () => {
    const text = formatGoalForTool(goal);
    expect(text).toContain("Goal: ship goal");
    expect(text).toContain("Status: active");
  });

  test("formats tool response payload", () => {
    const payload = formatGoalToolResponse(goal);
    expect(payload.remainingTokens).toBe(750);
  });

  test("handles missing goal", () => {
    const payload = formatGoalToolResponse(null);
    expect(payload.goal).toBeNull();
  });
});
