export type CodingPlanUsageWindow = "hour" | "5_hours" | "weekly" | "monthly";

export interface CodingPlanUsageLimit {
  window: CodingPlanUsageWindow;
  percentage: number;
  nextResetTime?: number;
}

export interface CodingPlanUsage {
  level?: string;
  limits: CodingPlanUsageLimit[];
}

export type CodingPlanLimitKind = "tokens" | "tool_calls";

export type CodingPlanLimitPeriod = "5h" | "weekly" | "monthly";

export interface CodingPlanWindowDetail {
  modelCode: string;
  usage: number;
}

export interface CodingPlanUsageWindowRaw {
  kind: CodingPlanLimitKind;
  period: CodingPlanLimitPeriod;
  usedPercentage: number;
  nextResetTime?: number;
  usage?: number;
  limit?: number;
  remaining?: number;
  details?: CodingPlanWindowDetail[];
}

export interface CodingPlanModelSummary {
  modelName: string;
  totalTokens: number;
}

export interface CodingPlanModelTotals {
  totalTokensUsage?: number;
  totalModelCallCount?: number;
  modelSummaryList?: CodingPlanModelSummary[];
}

export interface CodingPlanToolSummary {
  toolCode: string;
  toolName?: string;
  totalUsageCount: number;
}

export interface CodingPlanToolTotals {
  totalNetworkSearchCount?: number;
  totalWebReadMcpCount?: number;
  totalZreadMcpCount?: number;
  toolSummaryList?: CodingPlanToolSummary[];
}

export interface CodingPlanRawUsage {
  level?: string;
  windows: CodingPlanUsageWindowRaw[];
  modelTotals?: CodingPlanModelTotals;
  toolTotals?: CodingPlanToolTotals;
}
