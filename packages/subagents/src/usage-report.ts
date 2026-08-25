import type { Usage } from "@earendil-works/pi-ai";
import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "@htwang-contrib/common";
import type { SubagentUsageSnapshot } from "./run-agent.ts";

const CONFIG_ID = "subagents";

interface SubagentsExtensionConfig {
  reportUsage: boolean;
}

const CONFIG_SCHEMA: ExtensionConfigSchema<SubagentsExtensionConfig> = {
  defaults: { reportUsage: false },
};

export function loadReportUsage(): boolean {
  return readConfig(CONFIG_ID, CONFIG_SCHEMA).reportUsage;
}

export function registerSubagentsConfig(): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "reportUsage",
      type: "boolean",
      label: "Report Subagent Usage",
      value: () => loadReportUsage(),
      description:
        "Fold subagent token/cost spend into this session's own totals (visible in the footer and /cost under Tools/summaries).",
      extensionLabel: "Subagents",
      order: 0,
    },
  ]);
}

export type ReportableUsage = Pick<
  SubagentUsageSnapshot,
  "usage_input" | "usage_output" | "usage_cache_read" | "usage_cache_write" | "usage_cost_usd"
>;

export function toPiUsage(u: ReportableUsage): Usage | undefined {
  const input = u.usage_input ?? 0;
  const output = u.usage_output ?? 0;
  const cacheRead = u.usage_cache_read ?? 0;
  const cacheWrite = u.usage_cache_write ?? 0;
  const cost = u.usage_cost_usd ?? 0;
  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0 && cost === 0) return undefined;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  };
}

const pendingByParentSession = new Map<string, Usage>();

function addInto(target: Usage, delta: Usage): void {
  target.input += delta.input;
  target.output += delta.output;
  target.cacheRead += delta.cacheRead;
  target.cacheWrite += delta.cacheWrite;
  target.totalTokens += delta.totalTokens;
  target.cost.total += delta.cost.total;
}

export function poolBackgroundUsage(parentSessionId: string, u: ReportableUsage): void {
  if (!loadReportUsage()) return;
  const usage = toPiUsage(u);
  if (!usage) return;
  const existing = pendingByParentSession.get(parentSessionId);
  if (existing) {
    addInto(existing, usage);
  } else {
    pendingByParentSession.set(parentSessionId, usage);
  }
}

export function drainBackgroundUsage(parentSessionId: string): Usage | undefined {
  if (!loadReportUsage()) return undefined;
  const usage = pendingByParentSession.get(parentSessionId);
  if (!usage) return undefined;
  pendingByParentSession.delete(parentSessionId);
  return usage;
}

export function mergeUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
  if (!a) return b;
  if (!b) return a;
  const merged: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  addInto(merged, a);
  addInto(merged, b);
  return merged;
}
