import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { GoalAlreadyExistsError } from "./errors.ts";
import {
  accountGoalUsage,
  clearGoal,
  createGoal,
  goalFilePath,
  readGoal,
  updateGoal,
  type GoalStoreRef,
} from "./store.ts";

const tempDirs: string[] = [];

async function mkRef(): Promise<GoalStoreRef> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "goal-store-"));
  tempDirs.push(dir);
  return { baseDir: dir, threadId: "thread/1" };
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("goal store", () => {
  test("creates and reads goal", async () => {
    const ref = await mkRef();
    const created = await createGoal(ref, "Ship phase 2", 1000);
    const readBack = await readGoal(ref);
    expect(readBack?.id).toBe(created.id);
    expect(readBack?.objective).toBe("Ship phase 2");
    expect(readBack?.tokenBudget).toBe(1000);
  });

  test("rejects creating duplicate goal", async () => {
    const ref = await mkRef();
    await createGoal(ref, "Ship phase 2");
    await expect(createGoal(ref, "Ship phase 3")).rejects.toBeInstanceOf(
      GoalAlreadyExistsError,
    );
  });

  test("updates status and completion timestamp", async () => {
    const ref = await mkRef();
    await createGoal(ref, "Ship phase 2");
    const updated = await updateGoal(ref, { status: "complete" });
    expect(updated.status).toBe("complete");
    expect(updated.completedAt).toBeDefined();
  });

  test("accounts usage and flips to budgetLimited", async () => {
    const ref = await mkRef();
    await createGoal(ref, "Ship phase 2", 10);
    const updated = await accountGoalUsage(
      ref,
      { input: 4, output: 7, cacheRead: 0, cacheWrite: 0, totalTokens: 11 },
      5,
      "agent_end",
    );
    expect(updated?.tokensUsed).toBe(11);
    expect(updated?.timeUsedSeconds).toBe(5);
    expect(updated?.status).toBe("budgetLimited");
  });

  test("clears goal", async () => {
    const ref = await mkRef();
    await createGoal(ref, "Ship phase 2");
    await clearGoal(ref);
    expect(await readGoal(ref)).toBeNull();
  });

  test("encodes thread id in file path", async () => {
    const ref = await mkRef();
    const file = goalFilePath(ref);
    expect(path.basename(file)).toBe("thread%2F1.json");
  });
});
