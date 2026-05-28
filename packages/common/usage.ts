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
