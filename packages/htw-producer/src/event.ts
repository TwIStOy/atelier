import { hostname as osHostname } from "node:os";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DiffCounts } from "./diff-tracker.ts";
import type { GitContextCache } from "./git-context.ts";
import {
  AGENT_HARNESS,
  buildContextField,
  type ContextUsage,
  computeSessionCost,
  type DiffField,
  deriveTitle,
  modelName,
  type WorktreeField,
} from "./report.ts";

export type EventKind =
  | "session_started"
  | "user_prompt"
  | "thinking_started"
  | "thinking_finished"
  | "tool_started"
  | "tool_finished"
  | "waiting_for_user"
  | "turn_completed"
  | "turn_failed"
  | "session_ended";

export interface EventPayload {
  type: EventKind;
  text?: string;
  name?: string;
  args?: Record<string, unknown>;
}

export interface EventEnvelope {
  harness: string;
  session_id: string;
  cwd: string;
  event: EventPayload;
  host?: string;
  project?: string;
  model?: string;
  title?: string;
  pid?: number;
  tmux_pane?: string;
  cost?: number;
  context?: ContextUsage;
  diff?: DiffField;
  worktree?: WorktreeField;
  started_at?: number;
}

export function sessionKey(sessionId: string): string {
  return `${AGENT_HARNESS}/${sessionId}`;
}

export interface BuildEnvelopeInput {
  ctx: ExtensionContext;
  sessionId: string;
  startedAt: number;
  event: EventPayload;
  diff: DiffCounts;
  gitCache: GitContextCache;
  env?: NodeJS.ProcessEnv;
  pid?: number;
  hostname?: string;
}

export function buildEnvelope(input: BuildEnvelopeInput): EventEnvelope {
  const { ctx, sessionId, startedAt, event, diff, gitCache, env, pid, hostname } = input;
  const git = gitCache.get(ctx.cwd);

  const envelope: EventEnvelope = {
    harness: AGENT_HARNESS,
    session_id: sessionId,
    cwd: ctx.cwd,
    event,
    context: buildContextField(ctx),
    diff: { add: diff.add, delete: diff.delete },
    started_at: startedAt,
  };

  envelope.project = git.project;
  envelope.model = modelName(ctx);

  if (git.worktree) {
    envelope.worktree = { root: git.worktree.root, main: git.worktree.main };
    if (git.worktree.branch) envelope.worktree.branch = git.worktree.branch;
  }

  const cost = computeSessionCost(ctx);
  if (cost > 0) envelope.cost = Math.round(cost * 1_000_000) / 1_000_000;

  const tmuxPane = env?.TMUX_PANE;
  if (typeof tmuxPane === "string" && tmuxPane.length > 0) {
    envelope.tmux_pane = tmuxPane;
  }

  if (typeof pid === "number" && pid > 0) {
    envelope.pid = pid;
  }

  const host = hostname ?? osHostname();
  if (host.length > 0) envelope.host = host;

  const title = deriveTitle(ctx);
  if (title) envelope.title = title;

  return envelope;
}
