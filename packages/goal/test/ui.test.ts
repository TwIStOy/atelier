import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { Goal } from "../src/goal/types.ts";
import { displayedElapsedSeconds, renderGoalWidget } from "../src/goal/ui.ts";

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "g1",
    threadId: "t1",
    objective: "do the thing",
    status: "active",
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastStartedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

const passthroughTheme = { fg: (_color: string, text: string) => text } as unknown as Theme;

describe("displayedElapsedSeconds", () => {
  it("adds live elapsed time since lastStartedAt when active", () => {
    const goal = makeGoal({
      timeUsedSeconds: 120,
      lastStartedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toISOString(),
    });
    const now = Date.UTC(2026, 0, 1, 0, 0, 45);
    expect(displayedElapsedSeconds(goal, now)).toBeCloseTo(165, 5);
  });

  it("uses only timeUsedSeconds when paused", () => {
    const goal = makeGoal({ status: "paused", timeUsedSeconds: 200, lastStartedAt: null });
    expect(displayedElapsedSeconds(goal, Date.now())).toBe(200);
  });

  it("uses only timeUsedSeconds when complete", () => {
    const goal = makeGoal({ status: "complete", timeUsedSeconds: 350, lastStartedAt: null });
    expect(displayedElapsedSeconds(goal, Date.now())).toBe(350);
  });

  it("falls back to stored time when active but lastStartedAt is null", () => {
    const goal = makeGoal({ status: "active", timeUsedSeconds: 90, lastStartedAt: null });
    expect(displayedElapsedSeconds(goal, Date.now())).toBe(90);
  });

  it("ignores an unparseable lastStartedAt", () => {
    const goal = makeGoal({ status: "active", timeUsedSeconds: 10, lastStartedAt: "not-a-date" });
    expect(displayedElapsedSeconds(goal, Date.now())).toBe(10);
  });
});

describe("renderGoalWidget", () => {
  it("renders nothing when there is no goal", () => {
    expect(renderGoalWidget(null, passthroughTheme, 80)).toEqual([]);
  });

  it("renders the live elapsed time for an active goal", () => {
    const goal = makeGoal({
      status: "active",
      timeUsedSeconds: 0,
      lastStartedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toISOString(),
    });
    const now = Date.UTC(2026, 0, 1, 0, 0, 12);
    const lines = renderGoalWidget(goal, passthroughTheme, 80, now);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("◉ 12s");
    expect(lines[0]).toContain("do the thing");
  });

  it("renders the final elapsed time for a completed goal", () => {
    const goal = makeGoal({
      status: "complete",
      timeUsedSeconds: 125,
      lastStartedAt: null,
      completedAt: "2026-01-01T00:02:05.000Z",
    });
    const lines = renderGoalWidget(goal, passthroughTheme, 80);
    expect(lines[0]).toContain("✓ 2m 5s");
  });
});
