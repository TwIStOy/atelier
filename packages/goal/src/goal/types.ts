export type GoalStatus = "active" | "paused" | "budgetLimited" | "complete";

export type TokenUsageSnapshot = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
};

export type Goal = {
  id: string;
  threadId: string;
  objective: string;
  status: GoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: string;
  updatedAt: string;
  lastStartedAt: string | null;
  completedAt: string | null;
};

export type GoalFile = {
  version: number;
  goal: Goal | null;
};

export type GoalStoreRef = {
  baseDir: string;
  threadId: string;
};

export type GoalUpdate = {
  objective?: string;
  status?: GoalStatus;
  tokenBudget?: number | null;
};
