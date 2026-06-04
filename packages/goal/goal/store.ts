import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  GoalAlreadyExistsError,
  GoalNotFoundError,
  InvalidGoalStoreError,
  UnsupportedGoalStoreVersionError,
} from "./errors.ts";
import { validateObjective, validateTokenBudget } from "./validation.ts";
import type {
  Goal,
  GoalFile,
  GoalStoreRef,
  GoalUpdate,
  TokenUsageSnapshot,
} from "./types.ts";
export type { GoalStoreRef } from "./types.ts";

function nowIso(): string {
  return new Date().toISOString();
}

function ensureNonNegativeFinite(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeGoal(raw: unknown): Goal {
  if (!isRecord(raw)) {
    throw new InvalidGoalStoreError("Goal payload must be an object.");
  }
  const status = raw.status;
  if (
    status !== "active" &&
    status !== "paused" &&
    status !== "budgetLimited" &&
    status !== "complete"
  ) {
    throw new InvalidGoalStoreError("Goal status is invalid.");
  }
  if (typeof raw.id !== "string" || typeof raw.threadId !== "string") {
    throw new InvalidGoalStoreError("Goal id/threadId must be strings.");
  }
  if (typeof raw.objective !== "string") {
    throw new InvalidGoalStoreError("Goal objective must be a string.");
  }
  if (
    typeof raw.createdAt !== "string" ||
    typeof raw.updatedAt !== "string" ||
    typeof raw.tokensUsed !== "number" ||
    typeof raw.timeUsedSeconds !== "number"
  ) {
    throw new InvalidGoalStoreError("Goal payload is missing required fields.");
  }
  const tokenBudget = validateTokenBudget(raw.tokenBudget);
  const lastStartedAt =
    typeof raw.lastStartedAt === "string" ? raw.lastStartedAt : undefined;
  const completedAt =
    typeof raw.completedAt === "string" ? raw.completedAt : undefined;

  return {
    id: raw.id,
    threadId: raw.threadId,
    objective: validateObjective(raw.objective),
    status,
    tokenBudget,
    tokensUsed: ensureNonNegativeFinite(raw.tokensUsed),
    timeUsedSeconds: ensureNonNegativeFinite(raw.timeUsedSeconds),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    ...(lastStartedAt ? { lastStartedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
  };
}

export function goalFilePath(ref: GoalStoreRef): string {
  return path.join(ref.baseDir, `${encodeURIComponent(ref.threadId)}.json`);
}

export async function readGoal(ref: GoalStoreRef): Promise<Goal | null> {
  const file = goalFilePath(ref);
  let rawText: string;
  try {
    rawText = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    throw new InvalidGoalStoreError("Goal store file is not valid JSON.");
  }
  if (!isRecord(parsed)) {
    throw new InvalidGoalStoreError("Goal store file must be an object.");
  }
  if (parsed.version !== 1) {
    throw new UnsupportedGoalStoreVersionError(parsed.version);
  }
  const filePayload = parsed as GoalFile;
  if (filePayload.goal === null) return null;
  return sanitizeGoal(filePayload.goal);
}

export async function writeGoal(
  ref: GoalStoreRef,
  goal: Goal | null,
): Promise<void> {
  await fs.mkdir(ref.baseDir, { recursive: true });
  const file = goalFilePath(ref);
  const payload: GoalFile = { version: 1, goal };
  await fs.writeFile(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

export async function createGoal(
  ref: GoalStoreRef,
  objective: string,
  tokenBudget?: number,
): Promise<Goal> {
  const existing = await readGoal(ref);
  if (existing) {
    throw new GoalAlreadyExistsError();
  }
  const now = nowIso();
  const goal: Goal = {
    id: randomUUID(),
    threadId: ref.threadId,
    objective: validateObjective(objective),
    status: "active",
    tokenBudget: validateTokenBudget(tokenBudget),
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: now,
    updatedAt: now,
    lastStartedAt: now,
  };
  await writeGoal(ref, goal);
  return goal;
}

export async function updateGoal(
  ref: GoalStoreRef,
  update: GoalUpdate,
): Promise<Goal> {
  const current = await readGoal(ref);
  if (!current) {
    throw new GoalNotFoundError();
  }
  const now = nowIso();
  const goal: Goal = {
    ...current,
    ...(update.objective !== undefined
      ? { objective: validateObjective(update.objective) }
      : {}),
    ...(update.tokenBudget !== undefined
      ? { tokenBudget: validateTokenBudget(update.tokenBudget) }
      : {}),
  };

  if (update.status !== undefined) {
    goal.status = update.status;
    if (update.status === "active") {
      goal.lastStartedAt = now;
      delete goal.completedAt;
    } else {
      delete goal.lastStartedAt;
      if (update.status === "complete") {
        goal.completedAt = now;
      } else {
        delete goal.completedAt;
      }
    }
  }

  goal.updatedAt = now;
  await writeGoal(ref, goal);
  return goal;
}

export async function clearGoal(ref: GoalStoreRef): Promise<void> {
  await writeGoal(ref, null);
}

export async function accountGoalUsage(
  ref: GoalStoreRef,
  usage: TokenUsageSnapshot,
  elapsedSeconds: number,
  _mode: "agent_end" | "session_shutdown" | "manual" = "manual",
): Promise<Goal | null> {
  const goal = await readGoal(ref);
  if (!goal) return null;
  if (goal.status !== "active") return goal;

  const totalFromParts =
    ensureNonNegativeFinite(usage.input) +
    ensureNonNegativeFinite(usage.output) +
    ensureNonNegativeFinite(usage.cacheRead) +
    ensureNonNegativeFinite(usage.cacheWrite);
  const deltaTokens = Math.floor(
    ensureNonNegativeFinite(usage.totalTokens) || totalFromParts,
  );
  const deltaSeconds = Math.floor(ensureNonNegativeFinite(elapsedSeconds));

  goal.tokensUsed += deltaTokens;
  goal.timeUsedSeconds += deltaSeconds;
  goal.updatedAt = nowIso();

  if (
    goal.tokenBudget !== undefined &&
    goal.status === "active" &&
    goal.tokensUsed >= goal.tokenBudget
  ) {
    goal.status = "budgetLimited";
    delete goal.lastStartedAt;
  }

  await writeGoal(ref, goal);
  return goal;
}
