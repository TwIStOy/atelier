import { hostname as osHostname } from "node:os";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { userMessageText } from "@htwang-contrib/common";
import type { DiffCounts } from "./diff-tracker.ts";
import type { GitContextCache } from "./git-context.ts";

export type SessionStatus = "working" | "idle" | "waiting" | "error" | "ended";

export interface ContextUsage {
  percent: number;
  used?: number;
  window?: number;
}

export interface DiffField {
  add: number;
  delete: number;
}

export interface WorktreeField {
  root: string;
  main: string;
  branch?: string;
}

export interface ToolField {
  name: string;
  args: Record<string, unknown>;
}

export interface Report {
  id: string;
  project: string;
  cwd: string;
  model: string;
  status: SessionStatus;
  context: ContextUsage;
  diff: DiffField;
  worktree?: WorktreeField;
  tool?: ToolField;
  cost?: number;
  tmux_pane?: string;
  pid?: number;
  started_at?: number;
  agent?: string;
  title?: string;
  host?: string;
  last_user_input?: string;
  thinking?: boolean;
}

export const AGENT_HARNESS = "pi";
const TITLE_MAX_LEN = 80;

const SUMMARY_FIELDS = ["file", "path", "command", "pattern", "url", "query"] as const;
const MAX_VALUE_LEN = 200;

function truncate(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.length > MAX_VALUE_LEN ? `${value.slice(0, MAX_VALUE_LEN)}…` : value;
}

export function summarizeToolArgs(toolName: string, args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object") return {};
  const obj = args as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of SUMMARY_FIELDS) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) {
      summary[key] = truncate(value);
    }
  }
  if (toolName === "bash" && typeof obj.command === "string") {
    summary.command = truncate(obj.command);
  }
  return summary;
}

function modelName(ctx: ExtensionContext): string {
  const model = ctx.model as { name?: string; id?: string } | undefined;
  if (!model) return "unknown";
  return model.name || model.id || "unknown";
}

export { modelName };

function firstUserPrompt(ctx: ExtensionContext): string | undefined {
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const message = (entry as { message: { role?: string } }).message;
    if (message?.role !== "user") continue;
    const text = userMessageText(entry.message as UserMessage);
    return text || undefined;
  }
  return undefined;
}

function toSingleLine(text: string, maxLen: number): string {
  const line = text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (line.length <= maxLen) return line;
  return `${line.slice(0, maxLen - 1)}…`;
}

export function deriveTitle(ctx: ExtensionContext): string | undefined {
  const name = ctx.sessionManager.getSessionName();
  if (name && name.trim().length > 0) return name.trim();
  const prompt = firstUserPrompt(ctx);
  if (!prompt) return undefined;
  return toSingleLine(prompt, TITLE_MAX_LEN) || undefined;
}

export function computeSessionCost(ctx: ExtensionContext): number {
  let cost = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const message = (entry as { message: { role?: string } }).message;
    if (message?.role !== "assistant") continue;
    const assistant = entry.message as unknown as AssistantMessage;
    if (assistant.usage?.cost?.total) {
      cost += assistant.usage.cost.total;
    }
  }
  return cost;
}

export interface BuildReportInput {
  ctx: ExtensionContext;
  id: string;
  startedAt: number;
  status: SessionStatus;
  tool?: { name: string; args: unknown } | undefined;
  thinking?: boolean;
  lastUserInput?: string;
  diff: DiffCounts;
  gitCache: GitContextCache;
  env?: NodeJS.ProcessEnv;
  pid?: number;
  hostname?: string;
}

function buildContextField(ctx: ExtensionContext): ContextUsage {
  const usage = ctx.getContextUsage();
  const tokens = usage?.tokens;
  const window = usage?.contextWindow;
  const percent = usage?.percent;
  if (typeof percent === "number" && Number.isFinite(percent)) {
    return clampContext({ percent, used: tokens ?? undefined, window: window ?? undefined });
  }
  if (typeof tokens === "number" && typeof window === "number" && window > 0) {
    return clampContext({ percent: (tokens / window) * 100, used: tokens, window });
  }
  return { percent: 0 };
}

function clampContext(field: ContextUsage): ContextUsage {
  const percent = Math.max(0, Math.min(100, field.percent));
  const result: ContextUsage = {
    percent: Math.round(percent * 10) / 10,
  };
  if (typeof field.used === "number") result.used = Math.round(field.used);
  if (typeof field.window === "number") result.window = Math.round(field.window);
  return result;
}

export { buildContextField };

export function buildReport(input: BuildReportInput): Report {
  const { ctx, id, startedAt, status, tool, thinking, lastUserInput, diff, gitCache, env, pid, hostname } = input;
  const git = gitCache.get(ctx.cwd);

  const report: Report = {
    id,
    project: git.project,
    cwd: ctx.cwd,
    model: modelName(ctx),
    status,
    context: buildContextField(ctx),
    diff: { add: diff.add, delete: diff.delete },
    started_at: startedAt,
  };

  if (git.worktree) {
    report.worktree = { root: git.worktree.root, main: git.worktree.main };
    if (git.worktree.branch) report.worktree.branch = git.worktree.branch;
  }

  if (tool) {
    report.tool = { name: tool.name, args: summarizeToolArgs(tool.name, tool.args) };
  }

  const cost = computeSessionCost(ctx);
  if (cost > 0) report.cost = Math.round(cost * 1_000_000) / 1_000_000;

  const tmuxPane = env?.TMUX_PANE;
  if (typeof tmuxPane === "string" && tmuxPane.length > 0) {
    report.tmux_pane = tmuxPane;
  }

  if (typeof pid === "number" && pid > 0) {
    report.pid = pid;
  }

  report.agent = AGENT_HARNESS;

  const title = deriveTitle(ctx);
  if (title) report.title = title;

  const host = hostname ?? osHostname();
  if (host.length > 0) report.host = host;

  if (lastUserInput && lastUserInput.length > 0) {
    report.last_user_input = lastUserInput;
  }
  if (typeof thinking === "boolean") report.thinking = thinking;

  return report;
}
