import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Goal, GoalFile, GoalStoreRef, GoalUpdate, TokenUsageSnapshot } from "./types.ts";

export type { GoalStoreRef } from "./types.ts";

import {
  GoalAlreadyExistsError,
  GoalNotFoundError,
  InvalidGoalStoreError,
  UnsupportedGoalStoreVersionError,
} from "./errors.ts";

const CURRENT_VERSION = 1;

export function goalFilePath(ref: GoalStoreRef): string {
  return path.join(ref.baseDir, `${encodeURIComponent(ref.threadId)}.json`);
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readFile(filePath: string): GoalFile | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidGoalStoreError("File does not contain a valid object.");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.version !== "number") {
    throw new InvalidGoalStoreError("Missing version field.");
  }
  if (obj.version !== CURRENT_VERSION) {
    throw new UnsupportedGoalStoreVersionError(obj.version as number);
  }
  return obj as unknown as GoalFile;
}

function writeFile(filePath: string, file: GoalFile): void {
  ensureDir(filePath);
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

export function readGoal(ref: GoalStoreRef): Goal | null {
  const file = readFile(goalFilePath(ref));
  return file?.goal ?? null;
}

export function writeGoal(ref: GoalStoreRef, goal: Goal): void {
  const filePath = goalFilePath(ref);
  const file: GoalFile = { version: CURRENT_VERSION, goal };
  writeFile(filePath, file);
}

export function createGoal(ref: GoalStoreRef, objective: string, tokenBudget: number | null): Goal {
  const existing = readGoal(ref);
  if (existing) {
    throw new GoalAlreadyExistsError(existing.id);
  }

  const now = new Date().toISOString();
  const goal: Goal = {
    id: randomUUID(),
    threadId: ref.threadId,
    objective,
    status: "active",
    tokenBudget,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: now,
    updatedAt: now,
    lastStartedAt: now,
    completedAt: null,
  };

  writeGoal(ref, goal);
  return goal;
}

export function updateGoal(ref: GoalStoreRef, update: GoalUpdate): Goal {
  const goal = readGoal(ref);
  if (!goal) {
    throw new GoalNotFoundError(ref.threadId);
  }

  const now = new Date().toISOString();

  if (update.objective !== undefined) {
    goal.objective = update.objective;
  }
  if (update.tokenBudget !== undefined) {
    goal.tokenBudget = update.tokenBudget;
  }
  if (update.status !== undefined) {
    transitionStatus(goal, update.status, now);
  }

  goal.updatedAt = now;
  writeGoal(ref, goal);
  return goal;
}

function transitionStatus(goal: Goal, next: Goal["status"], now: string): void {
  const current = goal.status;

  switch (next) {
    case "paused":
      if (current === "active") {
        goal.status = "paused";
        goal.lastStartedAt = null;
      }
      break;
    case "active":
      if (current === "paused" || current === "budgetLimited") {
        goal.status = "active";
        goal.lastStartedAt = now;
      }
      break;
    case "complete":
      if (current === "active" || current === "paused" || current === "budgetLimited") {
        goal.status = "complete";
        goal.completedAt = now;
        goal.lastStartedAt = null;
      }
      break;
    case "budgetLimited":
      if (current === "active") {
        goal.status = "budgetLimited";
        goal.lastStartedAt = null;
      }
      break;
  }
}

export function clearGoal(ref: GoalStoreRef): void {
  const filePath = goalFilePath(ref);
  const file: GoalFile = { version: CURRENT_VERSION, goal: null };
  writeFile(filePath, file);
}

export type AccountUsageMode = "agentEnd" | "shutdown";

export function accountGoalUsage(
  ref: GoalStoreRef,
  usage: TokenUsageSnapshot,
  elapsedSeconds: number,
  _mode: AccountUsageMode,
): Goal {
  const goal = readGoal(ref);
  if (!goal) {
    throw new GoalNotFoundError(ref.threadId);
  }

  goal.tokensUsed += usage.totalTokens;
  goal.timeUsedSeconds += elapsedSeconds;
  goal.updatedAt = new Date().toISOString();

  if (goal.status === "active" && goal.tokenBudget !== null && goal.tokensUsed >= goal.tokenBudget) {
    goal.status = "budgetLimited";
    goal.lastStartedAt = null;
  }

  writeGoal(ref, goal);
  return goal;
}
