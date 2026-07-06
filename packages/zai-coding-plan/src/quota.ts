import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  CodingPlanLimitKind,
  CodingPlanLimitPeriod,
  CodingPlanModelTotals,
  CodingPlanRawUsage,
  CodingPlanToolTotals,
  CodingPlanUsage,
  CodingPlanUsageLimit,
  CodingPlanUsageWindow,
  CodingPlanUsageWindowRaw,
  CodingPlanWindowDetail,
} from "@htwang-contrib/common";
import {
  fitColWidths,
  formatNumber,
  formatProgressBar,
  makeTable,
  terminalWidth,
  ZAI_CODING_PLAN_EVENTS,
} from "@htwang-contrib/common";

const MONITOR_ENDPOINTS = {
  quotaLimit: "https://api.z.ai/api/monitor/usage/quota/limit",
  modelUsage: "https://api.z.ai/api/monitor/usage/model-usage",
  toolUsage: "https://api.z.ai/api/monitor/usage/tool-usage",
} as const;

const PERIOD_TO_WINDOW: Record<CodingPlanLimitPeriod, CodingPlanUsageWindow> = {
  "5h": "5_hours",
  weekly: "weekly",
  monthly: "monthly",
};

const WINDOW_ORDER: Record<CodingPlanUsageWindow, number> = {
  hour: 0,
  "5_hours": 1,
  weekly: 2,
  monthly: 3,
};

const PERIOD_LABELS: Record<CodingPlanLimitPeriod, string> = {
  "5h": "5h limit",
  weekly: "Weekly limit",
  monthly: "Monthly limit",
};

function classifyWindow(raw: Record<string, unknown>): CodingPlanUsageWindow | null {
  const descriptor = describeRawLimit(raw);
  return descriptor ? PERIOD_TO_WINDOW[descriptor.period] : null;
}

function parseUsageLimits(raw: Record<string, unknown>): CodingPlanUsageLimit[] {
  if (!Array.isArray(raw.limits)) return [];
  const limits: CodingPlanUsageLimit[] = [];
  for (const item of raw.limits as Array<Record<string, unknown>>) {
    const window = classifyWindow(item);
    if (!window) continue;
    limits.push({
      window,
      percentage: typeof item.percentage === "number" ? item.percentage : 0,
      nextResetTime: typeof item.nextResetTime === "number" ? item.nextResetTime : undefined,
    });
  }
  return limits.sort((a, b) => WINDOW_ORDER[a.window] - WINDOW_ORDER[b.window]);
}

function buildUsage(quota: Record<string, unknown> | null): CodingPlanUsage | null {
  if (!quota) return null;
  const limits = parseUsageLimits(quota);
  if (limits.length === 0 && typeof quota.level !== "string") return null;
  return {
    level: typeof quota.level === "string" ? quota.level : undefined,
    limits,
  };
}

interface RawLimitDescriptor {
  kind: CodingPlanLimitKind;
  period: CodingPlanLimitPeriod;
}

// Z.AI monitor encodes the quota window as (type, unit, number):
//   TIME_LIMIT    -> tool-call window (carries usageDetails with model codes)
//   TOKENS_LIMIT  -> token window
// The (type, unit, number) -> period mapping is fixed by the Z.AI API. This
// table is the single source of truth shared by describeRawLimit and
// classifyWindow so the two views never diverge.
const RAW_LIMIT_TABLE: Record<string, RawLimitDescriptor> = {
  TIME_LIMIT_5_1: { kind: "tool_calls", period: "monthly" },
  TOKENS_LIMIT_3_5: { kind: "tokens", period: "5h" },
  TOKENS_LIMIT_6_1: { kind: "tokens", period: "weekly" },
};

export function describeRawLimit(raw: Record<string, unknown>): RawLimitDescriptor | null {
  const type = raw.type;
  if (typeof type !== "string") return null;
  const unit = raw.unit;
  const number = raw.number;
  if (typeof unit !== "number" || typeof number !== "number") return null;
  const key = `${type}_${unit}_${number}`;
  const exact = RAW_LIMIT_TABLE[key];
  if (exact) return exact;
  if (type === "TIME_LIMIT") return { kind: "tool_calls", period: "monthly" };
  return null;
}

function parseRawWindowDetails(raw: Record<string, unknown>): CodingPlanWindowDetail[] | undefined {
  if (!Array.isArray(raw.usageDetails)) return undefined;
  const details: CodingPlanWindowDetail[] = [];
  for (const item of raw.usageDetails as Array<Record<string, unknown>>) {
    const modelCode = item.modelCode;
    const usage = item.usage;
    if (typeof modelCode !== "string" || typeof usage !== "number") continue;
    details.push({ modelCode, usage });
  }
  return details.length > 0 ? details : undefined;
}

function parseRawWindows(raw: Record<string, unknown> | null): CodingPlanUsageWindowRaw[] {
  if (!raw || !Array.isArray(raw.limits)) return [];
  const windows: CodingPlanUsageWindowRaw[] = [];
  for (const item of raw.limits as Array<Record<string, unknown>>) {
    const descriptor = describeRawLimit(item);
    if (!descriptor) continue;
    const percentage = typeof item.percentage === "number" ? item.percentage : 0;
    const nextResetTime = typeof item.nextResetTime === "number" ? item.nextResetTime : undefined;
    const window: CodingPlanUsageWindowRaw = {
      kind: descriptor.kind,
      period: descriptor.period,
      usedPercentage: percentage,
      nextResetTime,
    };
    if (typeof item.usage === "number") window.usage = item.usage;
    if (typeof item.currentValue === "number") window.limit = item.currentValue;
    if (typeof item.remaining === "number") window.remaining = item.remaining;
    const details = parseRawWindowDetails(item);
    if (details) window.details = details;
    windows.push(window);
  }
  return windows;
}

function parseModelTotals(raw: Record<string, unknown> | null): CodingPlanModelTotals | undefined {
  const totals = raw?.totalUsage;
  if (!totals || typeof totals !== "object") return undefined;
  const u = totals as Record<string, unknown>;
  const out: CodingPlanModelTotals = {};
  if (typeof u.totalTokensUsage === "number") out.totalTokensUsage = u.totalTokensUsage;
  if (typeof u.totalModelCallCount === "number") out.totalModelCallCount = u.totalModelCallCount;
  if (Array.isArray(u.modelSummaryList)) {
    out.modelSummaryList = (u.modelSummaryList as Array<Record<string, unknown>>)
      .filter((m) => typeof m.modelName === "string" && typeof m.totalTokens === "number")
      .map((m) => ({
        modelName: m.modelName as string,
        totalTokens: m.totalTokens as number,
      }));
  }
  if (
    out.totalTokensUsage === undefined &&
    out.totalModelCallCount === undefined &&
    (!out.modelSummaryList || out.modelSummaryList.length === 0)
  ) {
    return undefined;
  }
  return out;
}

function parseToolTotals(raw: Record<string, unknown> | null): CodingPlanToolTotals | undefined {
  const totals = raw?.totalUsage;
  if (!totals || typeof totals !== "object") return undefined;
  const u = totals as Record<string, unknown>;
  const out: CodingPlanToolTotals = {};
  if (typeof u.totalNetworkSearchCount === "number") out.totalNetworkSearchCount = u.totalNetworkSearchCount;
  if (typeof u.totalWebReadMcpCount === "number") out.totalWebReadMcpCount = u.totalWebReadMcpCount;
  if (typeof u.totalZreadMcpCount === "number") out.totalZreadMcpCount = u.totalZreadMcpCount;
  if (Array.isArray(u.toolSummaryList)) {
    out.toolSummaryList = (u.toolSummaryList as Array<Record<string, unknown>>)
      .filter((t) => typeof t.toolCode === "string" && typeof t.totalUsageCount === "number")
      .map((t) => ({
        toolCode: t.toolCode as string,
        toolName: typeof t.toolName === "string" ? t.toolName : undefined,
        totalUsageCount: t.totalUsageCount as number,
      }));
  }
  if (
    out.totalNetworkSearchCount === undefined &&
    out.totalWebReadMcpCount === undefined &&
    out.totalZreadMcpCount === undefined &&
    (!out.toolSummaryList || out.toolSummaryList.length === 0)
  ) {
    return undefined;
  }
  return out;
}

export function buildRawUsage(
  quota: Record<string, unknown> | null,
  model: Record<string, unknown> | null,
  tool: Record<string, unknown> | null,
): CodingPlanRawUsage | null {
  const windows = parseRawWindows(quota);
  const modelTotals = parseModelTotals(model);
  const toolTotals = parseToolTotals(tool);
  const level = quota && typeof quota.level === "string" ? quota.level : undefined;
  if (windows.length === 0 && !modelTotals && !toolTotals && !level) {
    return null;
  }
  return {
    level,
    windows,
    modelTotals,
    toolTotals,
  };
}

function getTimeWindowQueryParams(): string {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, now.getHours());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 59, 59, 999);
  return `startTime=${encodeURIComponent(fmt(start))}&endTime=${encodeURIComponent(fmt(end))}`;
}

async function fetchEndpoint(url: string, apiKey: string, queryParams?: string): Promise<Record<string, unknown>> {
  const fullUrl = queryParams ? `${url}?${queryParams}` : url;
  const resp = await fetch(fullUrl, {
    headers: {
      Authorization: apiKey,
      "Accept-Language": "en-US,en",
      "Content-Type": "application/json",
    },
  });
  if (!resp.ok) {
    throw new Error(`API error ${resp.status}: ${await resp.text()}`);
  }
  const json = (await resp.json()) as {
    data?: Record<string, unknown>;
  } & Record<string, unknown>;
  return json.data ?? json;
}

function formatResetDateTime(resetTime?: number): string {
  if (!resetTime) return "";
  const d = new Date(resetTime);
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const DD = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${MM}-${DD} ${hh}:${mm}`;
}

function formatWindowBar(window: CodingPlanUsageWindowRaw, barWidth: number): string {
  const label = PERIOD_LABELS[window.period];
  const remaining = Math.max(0, Math.round(100 - window.usedPercentage));
  const bar = formatProgressBar(window.usedPercentage, barWidth);
  const reset = formatResetDateTime(window.nextResetTime);
  const resetSuffix = reset ? ` (resets ${reset})` : "";
  const line = `${`${label}:`.padEnd(30)}${bar} ${remaining}% left${resetSuffix}`;
  return line.slice(0, terminalWidth());
}

function formatUsageOutput(
  rawUsage: CodingPlanRawUsage | null,
  model: Record<string, unknown> | null,
  tool: Record<string, unknown> | null,
): string {
  const parts: string[] = [];

  const level = rawUsage?.level ? ` (${rawUsage.level.charAt(0).toUpperCase()}${rawUsage.level.slice(1)})` : "";
  parts.push(`Z.AI Coding Plan Usage${level}`, "");

  const windows = rawUsage?.windows ?? [];
  const periodRank = (p: CodingPlanLimitPeriod) => WINDOW_ORDER[PERIOD_TO_WINDOW[p]];
  const tokenWindows = windows
    .filter((w) => w.kind === "tokens")
    .sort((a, b) => periodRank(a.period) - periodRank(b.period));
  const toolCallWindows = windows
    .filter((w) => w.kind === "tool_calls")
    .sort((a, b) => periodRank(a.period) - periodRank(b.period));
  const barWidth = 20;

  if (tokenWindows.length > 0 || model?.totalUsage) {
    parts.push("Model Usage", "");
    for (const window of tokenWindows) {
      parts.push(formatWindowBar(window, barWidth));
    }
    if (tokenWindows.length > 0) parts.push("");

    if (model?.totalUsage) {
      const u = model.totalUsage as Record<string, unknown>;
      const widths = fitColWidths(2, 22, 14);
      const t = makeTable(["Metric", "Value"], widths);
      if (typeof u.totalTokensUsage === "number") {
        t.push(["Total Tokens", formatNumber(u.totalTokensUsage)]);
      }
      if (typeof u.totalModelCallCount === "number") {
        t.push(["Total Calls", formatNumber(u.totalModelCallCount)]);
      }
      if (Array.isArray(u.modelSummaryList)) {
        for (const m of u.modelSummaryList as Array<Record<string, unknown>>) {
          if (typeof m.modelName === "string" && typeof m.totalTokens === "number") {
            t.push([`${m.modelName} Tokens`, formatNumber(m.totalTokens)]);
          }
        }
      }
      parts.push(t.toString(), "");
    }
  }

  if (toolCallWindows.length > 0 || tool?.totalUsage) {
    parts.push("Tool Usage", "");
    for (const window of toolCallWindows) {
      parts.push(formatWindowBar(window, barWidth));
    }
    if (toolCallWindows.length > 0) parts.push("");

    if (tool?.totalUsage) {
      const u = tool.totalUsage as Record<string, unknown>;
      const widths = fitColWidths(2, 20, 14);
      const t = makeTable(["Tool", "Count"], widths);
      if (typeof u.totalNetworkSearchCount === "number") {
        t.push(["Network Searches", formatNumber(u.totalNetworkSearchCount)]);
      }
      if (typeof u.totalWebReadMcpCount === "number") {
        t.push(["Web Reads", formatNumber(u.totalWebReadMcpCount)]);
      }
      if (typeof u.totalZreadMcpCount === "number") {
        t.push(["ZRead Calls", formatNumber(u.totalZreadMcpCount)]);
      }
      parts.push(t.toString(), "");
    }
  }

  return parts.join("\n");
}

export async function fetchUsage(apiKey: string): Promise<CodingPlanUsage | null> {
  const quota = await fetchEndpoint(MONITOR_ENDPOINTS.quotaLimit, apiKey).catch(() => null);
  return buildUsage(quota);
}

export async function fetchRawUsage(apiKey: string): Promise<CodingPlanRawUsage | null> {
  const queryParams = getTimeWindowQueryParams();
  const [quota, model, tool] = await Promise.all([
    fetchEndpoint(MONITOR_ENDPOINTS.quotaLimit, apiKey).catch(() => null),
    fetchEndpoint(MONITOR_ENDPOINTS.modelUsage, apiKey, queryParams).catch(() => null),
    fetchEndpoint(MONITOR_ENDPOINTS.toolUsage, apiKey, queryParams).catch(() => null),
  ]);
  return buildRawUsage(quota, model, tool);
}

export async function queryUsage(pi: ExtensionAPI, apiKey: string): Promise<string> {
  const queryParams = getTimeWindowQueryParams();

  const [quota, model, tool] = await Promise.all([
    fetchEndpoint(MONITOR_ENDPOINTS.quotaLimit, apiKey).catch(() => null),
    fetchEndpoint(MONITOR_ENDPOINTS.modelUsage, apiKey, queryParams).catch(() => null),
    fetchEndpoint(MONITOR_ENDPOINTS.toolUsage, apiKey, queryParams).catch(() => null),
  ]);

  const usage = buildUsage(quota);
  const rawUsage = buildRawUsage(quota, model, tool);
  if (rawUsage) {
    pi.events.emit(ZAI_CODING_PLAN_EVENTS.RAW_USAGE_UPDATE, {
      usage: rawUsage,
    });
  }
  if (usage) {
    pi.events.emit(ZAI_CODING_PLAN_EVENTS.USAGE_UPDATE, {
      usage,
    });
  }

  return formatUsageOutput(rawUsage, model, tool);
}
