import { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  formatProgressBar,
  formatNumber,
  terminalWidth,
  fitColWidths,
  makeTable,
} from "@htwang-contrib/common";
import type {
  CodingPlanUsage,
  CodingPlanUsageLimit,
  CodingPlanUsageWindow,
} from "@htwang-contrib/common";

const MONITOR_ENDPOINTS = {
  quotaLimit: "https://api.z.ai/api/monitor/usage/quota/limit",
  modelUsage: "https://api.z.ai/api/monitor/usage/model-usage",
  toolUsage: "https://api.z.ai/api/monitor/usage/tool-usage",
} as const;

const ZAI_CODING_PLAN_USAGE_EVENT = "pi-extensions:zai-coding-plan:usage";

const RAW_WINDOW_MAP: Record<string, CodingPlanUsageWindow> = {
  "3_5": "5_hours",
  "6_1": "weekly",
};

const WINDOW_ORDER: Record<CodingPlanUsageWindow, number> = {
  hour: 0,
  "5_hours": 1,
  weekly: 2,
  monthly: 3,
};

const WINDOW_LABELS: Record<CodingPlanUsageWindow, string> = {
  hour: "1h limit",
  "5_hours": "5h limit",
  weekly: "Weekly limit",
  monthly: "Monthly limit",
};

function classifyWindow(
  raw: Record<string, unknown>,
): CodingPlanUsageWindow | null {
  if (raw.type === "TIME_LIMIT") return "monthly";
  if (raw.type === "TOKENS_LIMIT") {
    const key = `${raw.unit}_${raw.number}`;
    return RAW_WINDOW_MAP[key as string] ?? null;
  }
  return null;
}

function parseUsageLimits(
  raw: Record<string, unknown>,
): CodingPlanUsageLimit[] {
  if (!Array.isArray(raw.limits)) return [];
  const limits: CodingPlanUsageLimit[] = [];
  for (const item of raw.limits as Array<Record<string, unknown>>) {
    const window = classifyWindow(item);
    if (!window) continue;
    limits.push({
      window,
      percentage: typeof item.percentage === "number" ? item.percentage : 0,
      nextResetTime:
        typeof item.nextResetTime === "number" ? item.nextResetTime : undefined,
    });
  }
  return limits.sort((a, b) => WINDOW_ORDER[a.window] - WINDOW_ORDER[b.window]);
}

function buildUsage(
  quota: Record<string, unknown> | null,
): CodingPlanUsage | null {
  if (!quota) return null;
  const limits = parseUsageLimits(quota);
  if (limits.length === 0 && typeof quota.level !== "string") return null;
  return {
    level: typeof quota.level === "string" ? quota.level : undefined,
    limits,
  };
}

function getTimeWindowQueryParams(): string {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
    now.getHours(),
  );
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    59,
    59,
    999,
  );
  return `startTime=${encodeURIComponent(fmt(start))}&endTime=${encodeURIComponent(fmt(end))}`;
}

async function fetchEndpoint(
  url: string,
  apiKey: string,
  queryParams?: string,
): Promise<Record<string, unknown>> {
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

function formatResetClock(resetTime?: number): string {
  if (!resetTime) return "";
  const d = new Date(resetTime);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatUsageOutput(
  usage: CodingPlanUsage | null,
  model: Record<string, unknown> | null,
  tool: Record<string, unknown> | null,
): string {
  const parts: string[] = [];

  const level = usage?.level
    ? ` (${usage.level.charAt(0).toUpperCase()}${usage.level.slice(1)})`
    : "";
  parts.push(`Z.AI Coding Plan Usage${level}`, "");

  if (usage && usage.limits.length > 0) {
    const barWidth = 20;
    const tw = terminalWidth();
    for (const limit of usage.limits) {
      const label = WINDOW_LABELS[limit.window];
      const pct = limit.percentage;
      const remaining = Math.max(0, Math.round(100 - pct));
      const bar = formatProgressBar(pct, barWidth);
      const reset = formatResetClock(limit.nextResetTime);
      const resetSuffix = reset ? ` (resets ${reset})` : "";
      const line =
        `${label}:`.padEnd(30) + `${bar} ${remaining}% left${resetSuffix}`;
      parts.push(line.slice(0, tw));
    }
    parts.push("");
  }

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
        if (
          typeof m.modelName === "string" &&
          typeof m.totalTokens === "number"
        ) {
          t.push([`${m.modelName} Tokens`, formatNumber(m.totalTokens)]);
        }
      }
    }
    parts.push("Model Usage", "", t.toString(), "");
  }

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
    parts.push("Tool Usage", "", t.toString(), "");
  }

  return parts.join("\n");
}

export async function fetchUsage(
  apiKey: string,
): Promise<CodingPlanUsage | null> {
  const quota = await fetchEndpoint(MONITOR_ENDPOINTS.quotaLimit, apiKey).catch(
    () => null,
  );
  return buildUsage(quota);
}

export async function queryUsage(
  pi: ExtensionAPI,
  apiKey: string,
): Promise<string> {
  const queryParams = getTimeWindowQueryParams();

  const [quota, model, tool] = await Promise.all([
    fetchEndpoint(MONITOR_ENDPOINTS.quotaLimit, apiKey).catch(() => null),
    fetchEndpoint(MONITOR_ENDPOINTS.modelUsage, apiKey, queryParams).catch(
      () => null,
    ),
    fetchEndpoint(MONITOR_ENDPOINTS.toolUsage, apiKey, queryParams).catch(
      () => null,
    ),
  ]);

  const usage = buildUsage(quota);
  if (usage) {
    pi.events.emit(ZAI_CODING_PLAN_USAGE_EVENT, {
      usage,
    });
  }

  return formatUsageOutput(usage, model, tool);
}
