import type {
  CodingPlanRawUsage,
  CodingPlanUsage,
  CodingPlanUsageWindow,
  CodingPlanUsageWindowRaw,
} from "@htwang-contrib/common";
import type { MoshiCredentials } from "./moshi-secrets.ts";

export interface MoshiUsageWindow {
  label: string;
  usedPercentage: number;
  resetsAt?: string;
}

export interface MoshiUsageSnapshot {
  accountId: string;
  accountLabel: string;
  agent: string;
  hostName: string;
  capturedAt: string;
  windows: MoshiUsageWindow[];
}

export interface MoshiUsagePushOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  signal?: AbortSignal;
}

// Moshi's usage API (POST /hosts/:hostId/usage) validates `agent` against a
// server-side const union of only "claude-code" | "codex" | "opencode"; any
// other value (including our real agent "pi") is rejected with HTTP 422 and
// the whole snapshot is dropped. Until "pi" is added upstream we publish Z.AI
// under "opencode" — the generic cross-provider agent (claude-code/codex imply
// a specific vendor). When Moshi accepts "pi", flip this single constant.
export const MOSHI_USAGE_AGENT = "opencode";
export const ZAI_ACCOUNT_ID = "zai:coding_plan";
export const ZAI_ACCOUNT_LABEL = "Z.AI Coding Plan";

const WINDOW_LABELS: Record<CodingPlanUsageWindow, string> = {
  hour: "1h",
  "5_hours": "5h",
  weekly: "Weekly",
  monthly: "Monthly",
};

export function windowLabelFor(window: CodingPlanUsageWindow): string {
  return WINDOW_LABELS[window] ?? window;
}

function labelForRawWindow(window: CodingPlanUsageWindowRaw): string {
  const kindSuffix = window.kind === "tool_calls" ? " tools" : " tokens";
  return `${window.period}${kindSuffix}`;
}

function resetIso(resetTime: number | undefined): string | undefined {
  if (typeof resetTime !== "number" || !Number.isFinite(resetTime)) {
    return undefined;
  }
  return new Date(resetTime).toISOString();
}

export function buildZaiSnapshot(
  usage: CodingPlanUsage,
  credentials: MoshiCredentials,
  now: Date = new Date(),
): MoshiUsageSnapshot {
  const windows: MoshiUsageWindow[] = usage.limits.map((limit) => ({
    label: windowLabelFor(limit.window),
    usedPercentage: clampPercent(limit.percentage),
    resetsAt: resetIso(limit.nextResetTime),
  }));

  return finalizeSnapshot(windows, usage.level, credentials, now);
}

export function buildZaiRawSnapshot(
  usage: CodingPlanRawUsage,
  credentials: MoshiCredentials,
  now: Date = new Date(),
): MoshiUsageSnapshot {
  const windows: MoshiUsageWindow[] = usage.windows.map((window) => ({
    label: labelForRawWindow(window),
    usedPercentage: clampPercent(window.usedPercentage),
    resetsAt: resetIso(window.nextResetTime),
  }));

  return finalizeSnapshot(windows, usage.level, credentials, now);
}

function finalizeSnapshot(
  windows: MoshiUsageWindow[],
  level: string | undefined,
  credentials: MoshiCredentials,
  now: Date,
): MoshiUsageSnapshot {
  const label = level
    ? `${ZAI_ACCOUNT_LABEL} (${capitalize(level)})`
    : ZAI_ACCOUNT_LABEL;

  return {
    accountId: ZAI_ACCOUNT_ID,
    accountLabel: label,
    agent: MOSHI_USAGE_AGENT,
    hostName: credentials.hostName,
    capturedAt: now.toISOString(),
    windows,
  };
}

export interface UsagePushResult {
  ok: boolean;
  status: number;
  body?: string;
}

export async function pushUsageSnapshot(
  snapshot: MoshiUsageSnapshot,
  credentials: MoshiCredentials,
  options: MoshiUsagePushOptions = {},
): Promise<UsagePushResult> {
  const fetchFn = options.fetch ?? fetch;
  const url = `${credentials.baseUrl}/hosts/${encodeURIComponent(credentials.hostId)}/usage`;
  try {
    const resp = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.hostSecret}`,
        "Content-Type": "application/json",
        "User-Agent": "pi-moshi-hooks-extra",
      },
      body: JSON.stringify({ snapshots: [snapshot] }),
      signal: options.signal,
    });
    const body = await resp.text();
    return { ok: resp.ok, status: resp.status, body };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: e instanceof Error ? e.message : String(e),
    };
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function capitalize(text: string): string {
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}
