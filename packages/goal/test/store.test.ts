import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountGoalUsage,
  createGoal,
  type GoalStoreRef,
  goalFilePath,
  readGoal,
  reopenActiveInterval,
  updateGoal,
} from "../src/goal/store.ts";
import type { Goal, TokenUsageSnapshot } from "../src/goal/types.ts";

function tempRef(): { ref: GoalStoreRef; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-store-"));
  return { ref: { baseDir: dir, threadId: "test-thread" }, dir };
}

function readRaw(ref: GoalStoreRef): Goal {
  const goal = readGoal(ref);
  if (!goal) throw new Error("goal missing");
  return goal;
}

function usage(totalTokens: number): TokenUsageSnapshot {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens };
}

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z").getTime();

describe("goal store time accounting", () => {
  let ctx: { ref: GoalStoreRef; dir: string };

  beforeEach(() => {
    ctx = tempRef();
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("folds the active interval into timeUsedSeconds when completing", () => {
    createGoal(ctx.ref, "ship it", null);
    const afterCreate = readRaw(ctx.ref);
    expect(afterCreate.timeUsedSeconds).toBe(0);
    expect(afterCreate.lastStartedAt).toBe(new Date(FIXED_NOW).toISOString());

    vi.setSystemTime(FIXED_NOW + 30_000);

    const completed = updateGoal(ctx.ref, { status: "complete" });
    expect(completed.status).toBe("complete");
    expect(completed.lastStartedAt).toBeNull();
    expect(Math.round(completed.timeUsedSeconds)).toBe(30);
  });

  it("folds the active interval when pausing and reopens it on resume", () => {
    createGoal(ctx.ref, "ship it", null);
    vi.setSystemTime(FIXED_NOW + 10_000);

    const paused = updateGoal(ctx.ref, { status: "paused" });
    expect(Math.round(paused.timeUsedSeconds)).toBe(10);
    expect(paused.lastStartedAt).toBeNull();

    vi.setSystemTime(FIXED_NOW + 100_000);
    const resumed = updateGoal(ctx.ref, { status: "active" });
    expect(Math.round(resumed.timeUsedSeconds)).toBe(10);
    expect(resumed.lastStartedAt).toBe(new Date(FIXED_NOW + 100_000).toISOString());

    vi.setSystemTime(FIXED_NOW + 130_000);
    const completed = updateGoal(ctx.ref, { status: "complete" });
    expect(Math.round(completed.timeUsedSeconds)).toBe(40);
  });

  it("does not accumulate wall-clock time at agent_end while still active", () => {
    createGoal(ctx.ref, "ship it", null);
    vi.setSystemTime(FIXED_NOW + 45_000);

    const goal = accountGoalUsage(ctx.ref, usage(500), "agentEnd");
    expect(goal.tokensUsed).toBe(500);
    expect(Math.round(goal.timeUsedSeconds)).toBe(0);
    expect(goal.status).toBe("active");
    expect(goal.lastStartedAt).toBe(new Date(FIXED_NOW).toISOString());
  });

  it("closes the active interval on shutdown accounting", () => {
    createGoal(ctx.ref, "ship it", null);
    vi.setSystemTime(FIXED_NOW + 20_000);

    const goal = accountGoalUsage(ctx.ref, usage(0), "shutdown");
    expect(Math.round(goal.timeUsedSeconds)).toBe(20);
    expect(goal.lastStartedAt).toBeNull();
  });

  it("closes the interval when hitting the token budget", () => {
    createGoal(ctx.ref, "ship it", 1000);
    vi.setSystemTime(FIXED_NOW + 5_000);

    const goal = accountGoalUsage(ctx.ref, usage(1500), "agentEnd");
    expect(goal.status).toBe("budgetLimited");
    expect(goal.tokensUsed).toBe(1500);
    expect(Math.round(goal.timeUsedSeconds)).toBe(5);
    expect(goal.lastStartedAt).toBeNull();
  });

  it("reopenActiveInterval resets lastStartedAt without double counting", () => {
    createGoal(ctx.ref, "ship it", null);
    vi.setSystemTime(FIXED_NOW + 8_000);

    const before = readRaw(ctx.ref);
    expect(before.timeUsedSeconds).toBe(0);

    vi.setSystemTime(FIXED_NOW + 1_000_000);
    const rebased = reopenActiveInterval(ctx.ref);
    expect(rebased?.lastStartedAt).toBe(new Date(FIXED_NOW + 1_000_000).toISOString());
    expect(Math.round(rebased!.timeUsedSeconds)).toBe(0);
  });

  it("reopenActiveInterval leaves a non-active goal untouched", () => {
    createGoal(ctx.ref, "ship it", null);
    updateGoal(ctx.ref, { status: "paused" });
    const rebased = reopenActiveInterval(ctx.ref);
    expect(rebased?.status).toBe("paused");
    expect(rebased?.lastStartedAt).toBeNull();
  });

  it("persists to a per-thread JSON file", () => {
    createGoal(ctx.ref, "ship it", null);
    expect(fs.existsSync(goalFilePath(ctx.ref))).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(goalFilePath(ctx.ref), "utf8"));
    expect(parsed.version).toBe(1);
    expect(parsed.goal.status).toBe("active");
  });
});
