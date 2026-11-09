import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  AgentSession,
  AgentSessionEvent,
  ExtensionContext,
  ExtensionFactory,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { getChildExtensionFactories } from "./child-extensions.ts";
import { recordChildSessionFinished, recordChildSessionStarted } from "./session-links.ts";
import { shutdownChildSession } from "./session-shutdown.ts";

export type ChildSessionUsage = {
  usage_input: number;
  usage_output: number;
  usage_cache_read?: number;
  usage_cache_write?: number;
  usage_cost_usd?: number;
  context_percent: number | null;
  context_tokens: number | null;
  context_window: number;
};

// Caller-supplied context (e.g. batch task_index/task_total) is spread into
// each progress payload after the engine fields.
export type EngineProgress = ChildSessionUsage & {
  tool_calls: number;
  sub_session_file?: string;
  [key: string]: unknown;
};

export interface ChildSessionSpec {
  sessionDir: string;
  systemPrompt: string;
  tools?: string[];
  customTools?: ToolDefinition[];
  // Caller resolves the model (subagent tiers, verifier fallback); undefined
  // defers to pi's own default resolution.
  model: ExtensionContext["model"];
  thinkingLevel?: ThinkingLevel;
  extensionFactories?: ExtensionFactory[];
  // Default true: merge getChildExtensionFactories() after the caller's.
  includeChildExtensions?: boolean;
  // Default false (loader runs with noSkills); the verifier passes true.
  skills?: boolean;
  // Default true: record session-links entries; the verifier passes false.
  linkParent?: boolean;
  // Soft steer at maxTurns, hard abort at maxTurns + 3.
  maxTurns?: number;
  signal?: AbortSignal;
  onProgress?: (p: EngineProgress) => void;
  progressContext?: Record<string, unknown>;
}

export interface ChildSessionHandle {
  session: AgentSession;
  toolCallCount(): number;
  markError(): void;
}

export function childUsageSnapshot(session: AgentSession): ChildSessionUsage {
  const st = session.getSessionStats();
  const cu = session.getContextUsage();
  const cw = cu?.contextWindow ?? session.model?.contextWindow ?? 0;
  return {
    usage_input: st.tokens.input,
    usage_output: st.tokens.output,
    usage_cache_read: st.tokens.cacheRead,
    usage_cache_write: st.tokens.cacheWrite,
    usage_cost_usd: st.cost,
    context_percent: cu?.percent ?? null,
    context_tokens: cu?.tokens ?? null,
    context_window: cw,
  };
}

const TURN_LIMIT_GRACE = 3;

type TurnLimitState = { count: number; soft: boolean };

function applyTurnLimitAction(state: TurnLimitState, session: AgentSession, maxTurns: number): void {
  if (!state.soft && state.count >= maxTurns) {
    state.soft = true;
    void session.steer(
      "You have reached the turn limit. Finish now with a short final answer; do not start new tool work.",
    );
    return;
  }
  if (state.soft && state.count >= maxTurns + TURN_LIMIT_GRACE) {
    void session.abort();
  }
}

// One engine for every child session: spawn (loader flags, session dir, parent
// link, createAgentSession, bindExtensions, session-links record), observe
// (progress assembly with spec.progressContext, turn limiter), abort forwarding
// with a pre-aborted check, and Settle — always in finally. Spawn failures
// throw out before any of that; what the spawned session actually does is the
// caller's Driver.
export async function withChildSession<T>(
  ctx: ExtensionContext,
  spec: ChildSessionSpec,
  driver: (h: ChildSessionHandle) => Promise<T>,
): Promise<T> {
  const cwd = ctx.cwd;
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const parentSessionId = ctx.sessionManager.getHeader()?.id;
  const parentSessionFile = ctx.sessionManager.getSessionFile() ?? "";
  const linkParent = spec.linkParent ?? true;

  fs.mkdirSync(spec.sessionDir, { recursive: true });
  const sessionManager = SessionManager.create(cwd, spec.sessionDir, {
    id: randomUUID(),
    ...(parentSessionId ? { parentSession: parentSessionId } : {}),
  });

  const extensionFactories =
    spec.includeChildExtensions === false
      ? (spec.extensionFactories ?? [])
      : [...(spec.extensionFactories ?? []), ...getChildExtensionFactories()];

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    extensionFactories,
    noSkills: !(spec.skills ?? false),
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => spec.systemPrompt,
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  const modelRuntime = await ModelRuntime.create();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model: spec.model,
    thinkingLevel: spec.thinkingLevel,
    tools: spec.tools,
    customTools: spec.customTools,
    resourceLoader: loader,
    sessionManager,
    settingsManager,
  });

  let errored = false;
  let toolCalls = 0;
  const handle: ChildSessionHandle = {
    session,
    toolCallCount: () => toolCalls,
    markError: () => {
      errored = true;
    },
  };

  let unsub = () => {};
  let detachAbort = () => {};
  try {
    await session.bindExtensions({});
    if (linkParent) {
      recordChildSessionStarted(parentSessionId ?? "unknown", {
        parentSessionFile,
        childSessionFile: session.sessionManager.getSessionFile() ?? "",
      });
    }

    const turnLimit: TurnLimitState = { count: 0, soft: false };
    const emitProgress = () => {
      spec.onProgress?.({
        tool_calls: toolCalls,
        sub_session_file: session.sessionManager.getSessionFile(),
        ...childUsageSnapshot(session),
        ...(spec.progressContext ?? {}),
      });
    };
    unsub = session.subscribe((event: AgentSessionEvent) => {
      if (event.type === "tool_execution_end") {
        toolCalls += 1;
        emitProgress();
        return;
      }
      if (event.type !== "turn_end") return;
      emitProgress();
      if (spec.maxTurns === undefined || spec.maxTurns <= 0) return;
      turnLimit.count += 1;
      applyTurnLimitAction(turnLimit, session, spec.maxTurns);
    });

    // Abort forwarding with a pre-aborted check: an already-aborted signal
    // aborts the session immediately and never runs the driver.
    const onAbort = () => {
      void session.abort();
    };
    const preAborted = spec.signal?.aborted === true;
    if (spec.signal && !preAborted) {
      spec.signal.addEventListener("abort", onAbort, { once: true });
    }
    detachAbort = () => spec.signal?.removeEventListener("abort", onAbort);

    if (preAborted) {
      onAbort();
      errored = true;
      throw new Error("child session aborted before start");
    }
    emitProgress();
    return await driver(handle);
  } catch (e) {
    errored = true;
    throw e;
  } finally {
    // Settle: unsubscribe, detach abort, record the finished link with the
    // outcome status, and shut the session down — whether the Driver threw,
    // errored, or succeeded.
    unsub();
    detachAbort();
    const subFile = session.sessionManager.getSessionFile();
    if (linkParent && subFile) {
      recordChildSessionFinished(parentSessionId ?? "unknown", {
        parentSessionFile,
        childSessionFile: subFile,
        toolCalls,
        status: errored ? "error" : "done",
      });
    }
    await shutdownChildSession(session);
  }
}
