export type GoalStatus = "active" | "paused" | "budgetLimited" | "complete";

export type Goal = {
  id: string;
  threadId: string;
  objective: string;
  status: GoalStatus;
  tokenBudget?: number;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: string;
  updatedAt: string;
  lastStartedAt?: string;
  completedAt?: string;
};

export type TokenUsageSnapshot = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
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

export type GoalFile = {
  version: 1;
  goal: Goal | null;
};
