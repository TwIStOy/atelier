const MONITOR_ENDPOINTS = {
  quotaLimit: "https://api.z.ai/api/monitor/usage/quota/limit",
  modelUsage: "https://api.z.ai/api/monitor/usage/model-usage",
  toolUsage: "https://api.z.ai/api/monitor/usage/tool-usage",
} as const;

function getTimeWindowQueryParams(): string {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, now.getHours());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 59, 59, 999);
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
  const json = (await resp.json()) as { data?: Record<string, unknown> } & Record<string, unknown>;
  return json.data ?? json;
}

function formatPercentage(value: unknown): string {
  if (typeof value === "number") return `${value.toFixed(1)}%`;
  return "N/A";
}

function formatResetTime(resetTime?: number): string {
  if (!resetTime) return "—";
  const diff = resetTime - Date.now();
  if (diff <= 0) return "—";
  const totalMinutes = Math.floor(diff / 60000);
  if (totalMinutes >= 1440) {
    const hours = Math.floor(totalMinutes / 60);
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  }
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

const TOKENS_LIMIT_LABELS: Record<string, string> = {
  "3_5": "Token usage (5 Hour)",
  "6_1": "Token usage (Weekly)",
};

function getTokensLimitLabel(limit: Record<string, unknown>): string {
  const key = `${limit.unit}_${limit.number}`;
  return TOKENS_LIMIT_LABELS[key] ?? `Token usage (unit=${limit.unit}, number=${limit.number})`;
}

function formatQuotaOutput(
  quota: Record<string, unknown> | null,
  model: Record<string, unknown> | null,
  tool: Record<string, unknown> | null,
): string {
  const lines: string[] = [];

  const level = typeof quota?.level === "string" ? ` (${(quota.level as string).charAt(0).toUpperCase()}${(quota.level as string).slice(1)})` : "";
  lines.push(`### Z.AI Coding Plan Usage${level}\n`);

  if (quota?.limits && Array.isArray(quota.limits)) {
    lines.push("| Window | Usage | Resets In |");
    lines.push("|--------|------:|-----------|");
    for (const limit of quota.limits as Array<Record<string, unknown>>) {
      let label: string;
      if (limit.type === "TOKENS_LIMIT") {
        label = getTokensLimitLabel(limit);
      } else if (limit.type === "TIME_LIMIT") {
        label = "MCP usage (1 Month)";
      } else {
        label = typeof limit.type === "string" ? limit.type : "Unknown";
      }
      const pct = formatPercentage(limit.percentage);
      const reset = formatResetTime(limit.nextResetTime as number | undefined);
      lines.push(`| ${label} | ${pct} | ${reset} |`);
    }
    lines.push("");
  }

  if (model?.totalUsage) {
    const u = model.totalUsage as Record<string, unknown>;
    lines.push("### Model Usage\n");
    lines.push("| Metric | Value |");
    lines.push("|--------|------:|");
    if (typeof u.totalTokensUsage === "number") {
      lines.push(`| Total Tokens | ${formatNumber(u.totalTokensUsage)} |`);
    }
    if (typeof u.totalModelCallCount === "number") {
      lines.push(`| Total Calls | ${formatNumber(u.totalModelCallCount)} |`);
    }
    if (Array.isArray(u.modelSummaryList)) {
      for (const m of u.modelSummaryList as Array<Record<string, unknown>>) {
        if (typeof m.modelName === "string" && typeof m.totalTokens === "number") {
          lines.push(`| ${m.modelName} Tokens | ${formatNumber(m.totalTokens)} |`);
        }
      }
    }
    lines.push("");
  }

  if (tool?.totalUsage) {
    const u = tool.totalUsage as Record<string, unknown>;
    lines.push("### Tool Usage\n");
    lines.push("| Tool | Count |");
    lines.push("|------|------:|");
    if (typeof u.totalNetworkSearchCount === "number") {
      lines.push(`| Network Searches | ${formatNumber(u.totalNetworkSearchCount)} |`);
    }
    if (typeof u.totalWebReadMcpCount === "number") {
      lines.push(`| Web Reads | ${formatNumber(u.totalWebReadMcpCount)} |`);
    }
    if (typeof u.totalZreadMcpCount === "number") {
      lines.push(`| ZRead Calls | ${formatNumber(u.totalZreadMcpCount)} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function queryUsage(apiKey: string): Promise<string> {
  const queryParams = getTimeWindowQueryParams();

  const [quota, model, tool] = await Promise.all([
    fetchEndpoint(MONITOR_ENDPOINTS.quotaLimit, apiKey).catch(() => null),
    fetchEndpoint(MONITOR_ENDPOINTS.modelUsage, apiKey, queryParams).catch(() => null),
    fetchEndpoint(MONITOR_ENDPOINTS.toolUsage, apiKey, queryParams).catch(() => null),
  ]);

  return formatQuotaOutput(quota, model, tool);
}
