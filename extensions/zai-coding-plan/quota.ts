import { formatProgressBar, formatNumber } from "../utils/format.ts";
import { terminalWidth, fitColWidths, makeTable } from "../utils/terminal.ts";

const MONITOR_ENDPOINTS = {
  quotaLimit: "https://api.z.ai/api/monitor/usage/quota/limit",
  modelUsage: "https://api.z.ai/api/monitor/usage/model-usage",
  toolUsage: "https://api.z.ai/api/monitor/usage/tool-usage",
} as const;

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

const TOKENS_LIMIT_LABELS: Record<string, string> = {
  "3_5": "5h limit",
  "6_1": "Weekly limit",
};

const LIMIT_ORDER: Record<string, number> = {
  "3_5": 0,
  "6_1": 1,
  TIME_LIMIT: 2,
};

function getLimitOrder(limit: Record<string, unknown>): number {
  const key = limit.type === "TIME_LIMIT" ? "TIME_LIMIT" : `${limit.unit}_${limit.number}`;
  return LIMIT_ORDER[key as string] ?? 99;
}

function getLimitLabel(limit: Record<string, unknown>): string {
  if (limit.type === "TOKENS_LIMIT") {
    const key = `${limit.unit}_${limit.number}`;
    return TOKENS_LIMIT_LABELS[key] ?? `Limit (unit=${limit.unit}, number=${limit.number})`;
  }
  if (limit.type === "TIME_LIMIT") return "Monthly limit";
  return typeof limit.type === "string" ? limit.type : "Unknown";
}

function formatQuotaOutput(
  quota: Record<string, unknown> | null,
  model: Record<string, unknown> | null,
  tool: Record<string, unknown> | null,
): string {
  const parts: string[] = [];

  const level =
    typeof quota?.level === "string"
      ? ` (${(quota.level as string).charAt(0).toUpperCase()}${(quota.level as string).slice(1)})`
      : "";
  parts.push(`Z.AI Coding Plan Usage${level}`, "");

  if (quota?.limits && Array.isArray(quota.limits)) {
    const barWidth = 20;
    const tw = terminalWidth();
    const limits = (quota.limits as Array<Record<string, unknown>>)
      .slice()
      .sort((a, b) => getLimitOrder(a) - getLimitOrder(b));
    for (const limit of limits) {
      const label = getLimitLabel(limit);
      const pct = typeof limit.percentage === "number" ? limit.percentage : 0;
      const remaining = Math.max(0, Math.round(100 - pct));
      const bar = formatProgressBar(pct, barWidth);
      const reset = formatResetClock(limit.nextResetTime as number | undefined);
      const resetSuffix = reset ? ` (resets ${reset})` : "";
      const line = `${label}:`.padEnd(30) + `${bar} ${remaining}% left${resetSuffix}`;
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

export async function queryUsage(apiKey: string): Promise<string> {
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

  return formatQuotaOutput(quota, model, tool);
}
