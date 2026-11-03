import vm from "node:vm";
import { parseWorkflowScript, type WorkflowMeta } from "./script.ts";

export type WorkflowAgentCall = {
  label: string;
  task: string;
  agent_type?: string;
  model?: string;
  thinking?: string;
  inherit_context?: boolean;
  isolated?: boolean;
  max_turns?: number;
  schema?: Record<string, unknown>;
};

export type WorkflowAgentRunResult = {
  ok: boolean;
  value?: unknown;
  text?: string;
  error?: string;
};

export type WorkflowAgentRunner = (
  call: WorkflowAgentCall,
  ctx: { signal: AbortSignal | undefined; onProgress: (toolCalls: number) => void },
) => Promise<WorkflowAgentRunResult>;

export type WorkflowAgentStatus = "queued" | "running" | "done" | "error" | "aborted";

export type WorkflowAgentSnapshot = {
  id: number;
  label: string;
  phase: string | null;
  status: WorkflowAgentStatus;
  toolCalls: number;
  detail?: string;
  cached?: boolean;
  startedAt: number;
  endedAt?: number;
};

export type WorkflowPhaseSnapshot = {
  title: string;
  status: "active" | "done";
  startedAt: number;
  endedAt?: number;
};

export type WorkflowStatus = "running" | "done" | "error" | "aborted";

export type WorkflowSnapshot = {
  name: string;
  description: string;
  status: WorkflowStatus;
  phases: WorkflowPhaseSnapshot[];
  agents: WorkflowAgentSnapshot[];
  logs: string[];
  startedAt: number;
  endedAt?: number;
  error?: string;
};

export type ResumeAgentRecord = {
  seq: number;
  call: WorkflowAgentCall;
  ok: boolean;
  value?: unknown;
  text?: string;
};

export type ResumeState = {
  agents: ResumeAgentRecord[];
  cutoff: number;
};

export type AgentSettledRecord = {
  seq: number;
  call: WorkflowAgentCall;
  ok: boolean;
  value?: unknown;
  text?: string;
  error?: string;
  endedAt: number;
};

export type RunWorkflowOptions = {
  args?: unknown;
  signal?: AbortSignal;
  runAgent: WorkflowAgentRunner;
  maxConcurrency: number;
  maxAgents: number;
  resume?: ResumeState;
  onAgentSettled?: (record: AgentSettledRecord) => void;
  onSnapshot?: (snapshot: WorkflowSnapshot) => void;
};

export type WorkflowRunResult = {
  ok: boolean;
  value?: unknown;
  error?: string;
  snapshot: WorkflowSnapshot;
};

const MAX_LOG_LINES = 200;

class Semaphore {
  private available: number;
  private queue: Array<() => void> = [];

  constructor(capacity: number) {
    this.available = Math.max(1, capacity);
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
      return;
    }
    this.available += 1;
  }
}

function formatConsoleArg(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

type AgentOutcome = {
  ok: boolean;
  value?: unknown;
  text?: string;
  error?: string;
};

type AgentContext = {
  options: RunWorkflowOptions;
  snapshot: WorkflowSnapshot;
  semaphore: Semaphore;
  emit: () => void;
  pushLog: (level: string, values: unknown[]) => void;
  isAborted: () => boolean;
  currentPhase: () => string | null;
};

function assertAgentObject(call: WorkflowAgentCall): void {
  if (!call || typeof call !== "object") {
    throw new Error("agent() expects a single options object");
  }
}

function assertAgentLabel(call: WorkflowAgentCall): void {
  if (typeof call.label !== "string" || !call.label.trim()) {
    throw new Error("agent() requires a non-empty string `label`");
  }
}

function assertAgentTask(call: WorkflowAgentCall): void {
  if (typeof call.task !== "string" || !call.task.trim()) {
    throw new Error(`agent("${call.label}") requires a non-empty string \`task\``);
  }
}

function isPlainSchemaObject(schema: unknown): boolean {
  return typeof schema === "object" && schema !== null && !Array.isArray(schema);
}

function assertAgentSchema(call: WorkflowAgentCall): void {
  if (call.schema === undefined) return;
  if (!isPlainSchemaObject(call.schema)) {
    throw new Error(`agent("${call.label}"): schema must be a JSON Schema object`);
  }
  if (call.schema.type !== "object") {
    throw new Error(`agent("${call.label}"): schema must have type: "object" at the top level`);
  }
}

function validateAgentCall(call: WorkflowAgentCall): void {
  assertAgentObject(call);
  assertAgentLabel(call);
  assertAgentTask(call);
  assertAgentSchema(call);
}

function agentReturnValue(value: unknown, text: string | undefined): unknown {
  return value !== undefined ? value : (text ?? null);
}

function findCachedAgent(call: WorkflowAgentCall, seq: number, resume: ResumeState): ResumeAgentRecord | null {
  if (seq >= resume.cutoff) return null;
  const cached = resume.agents.find((r) => r.seq === seq);
  if (cached?.ok && JSON.stringify(cached.call) === JSON.stringify(call)) return cached;
  return null;
}

function recordCachedAgent(
  ctx: AgentContext,
  seq: number,
  call: WorkflowAgentCall,
  cached: ResumeAgentRecord,
): unknown {
  const entry: WorkflowAgentSnapshot = {
    id: seq,
    label: call.label.trim(),
    phase: ctx.currentPhase(),
    status: "done",
    toolCalls: 0,
    cached: true,
    startedAt: Date.now(),
    endedAt: Date.now(),
  };
  ctx.snapshot.agents.push(entry);
  ctx.emit();
  ctx.options.onAgentSettled?.({
    seq,
    call,
    ok: true,
    value: cached.value,
    text: cached.text,
    endedAt: entry.endedAt!,
  });
  return agentReturnValue(cached.value, cached.text);
}

type AgentAttemptState = { outcome?: AgentOutcome };

function settleAborted(entry: WorkflowAgentSnapshot, state: AgentAttemptState): null {
  entry.status = "aborted";
  entry.endedAt = Date.now();
  state.outcome = { ok: false, error: "aborted" };
  return null;
}

function settleResult(
  ctx: AgentContext,
  entry: WorkflowAgentSnapshot,
  result: WorkflowAgentRunResult,
  state: AgentAttemptState,
): unknown {
  if (result.ok) {
    entry.status = "done";
    state.outcome = { ok: true, value: result.value, text: result.text };
    return agentReturnValue(result.value, result.text);
  }
  entry.status = ctx.isAborted() ? "aborted" : "error";
  entry.detail = result.error;
  state.outcome = { ok: false, error: result.error };
  ctx.pushLog("error", [`agent("${entry.label}") failed: ${result.error ?? "unknown error"}`]);
  return null;
}

function settleThrow(ctx: AgentContext, entry: WorkflowAgentSnapshot, e: unknown, state: AgentAttemptState): null {
  entry.status = ctx.isAborted() ? "aborted" : "error";
  const detail = e instanceof Error ? e.message : String(e);
  entry.detail = detail;
  state.outcome = { ok: false, error: detail };
  ctx.pushLog("error", [`agent("${entry.label}") threw: ${detail}`]);
  return null;
}

async function attemptAgent(
  ctx: AgentContext,
  entry: WorkflowAgentSnapshot,
  call: WorkflowAgentCall,
  state: AgentAttemptState,
): Promise<unknown> {
  if (ctx.isAborted()) {
    return settleAborted(entry, state);
  }
  try {
    entry.status = "running";
    ctx.emit();
    const result = await ctx.options.runAgent(call, {
      signal: ctx.options.signal,
      onProgress: (toolCalls) => {
        entry.toolCalls = toolCalls;
        ctx.emit();
      },
    });
    return settleResult(ctx, entry, result, state);
  } catch (e) {
    return settleThrow(ctx, entry, e, state);
  }
}

async function runLiveAgent(ctx: AgentContext, seq: number, call: WorkflowAgentCall): Promise<unknown> {
  const entry: WorkflowAgentSnapshot = {
    id: seq,
    label: call.label.trim(),
    phase: ctx.currentPhase(),
    status: "queued",
    toolCalls: 0,
    startedAt: Date.now(),
  };
  ctx.snapshot.agents.push(entry);
  ctx.emit();
  await ctx.semaphore.acquire();
  const state: AgentAttemptState = {};
  try {
    return await attemptAgent(ctx, entry, call, state);
  } finally {
    entry.endedAt = Date.now();
    ctx.semaphore.release();
    ctx.options.onAgentSettled?.({ seq, call, ...state.outcome!, endedAt: entry.endedAt });
    ctx.emit();
  }
}

export async function runWorkflow(rawScript: string, options: RunWorkflowOptions): Promise<WorkflowRunResult> {
  const parsed = parseWorkflowScript(rawScript);
  if (!parsed.ok) {
    const snapshot = emptySnapshot({ name: "(invalid script)", description: "" }, "error", parsed.error);
    options.onSnapshot?.(snapshot);
    return { ok: false, error: parsed.error, snapshot };
  }

  const { meta, body } = parsed.script;
  const snapshot: WorkflowSnapshot = {
    name: meta.name,
    description: meta.description,
    status: "running",
    phases: [],
    agents: [],
    logs: [],
    startedAt: Date.now(),
  };

  const emit = () => options.onSnapshot?.(snapshot);
  const semaphore = new Semaphore(options.maxConcurrency);
  const maxAgents = Math.max(1, options.maxAgents);
  let agentSeq = 0;
  let currentPhase: string | null = null;
  let aborted = false;

  const signal = options.signal;
  const onAbort = () => {
    aborted = true;
    for (const agent of snapshot.agents) {
      if (agent.status === "running" || agent.status === "queued") {
        agent.status = "aborted";
        agent.endedAt = Date.now();
      }
    }
    emit();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const pushLog = (level: string, values: unknown[]) => {
    const line = values.map(formatConsoleArg).join(" ");
    snapshot.logs.push(`[${level}] ${line}`);
    if (snapshot.logs.length > MAX_LOG_LINES) {
      snapshot.logs.splice(0, snapshot.logs.length - MAX_LOG_LINES);
    }
    emit();
  };

  const agentCtx: AgentContext = {
    options,
    snapshot,
    semaphore,
    emit,
    pushLog,
    isAborted: () => aborted,
    currentPhase: () => currentPhase,
  };

  const agent = async (call: WorkflowAgentCall): Promise<unknown> => {
    validateAgentCall(call);
    agentSeq += 1;
    if (agentSeq > maxAgents) {
      throw new Error(`workflow agent limit exceeded: more than ${maxAgents} agent() calls`);
    }
    const cached = options.resume ? findCachedAgent(call, agentSeq, options.resume) : null;
    if (cached) {
      return recordCachedAgent(agentCtx, agentSeq, call, cached);
    }
    return runLiveAgent(agentCtx, agentSeq, call);
  };

  const parallel = async (fns: unknown): Promise<unknown[]> => {
    if (!Array.isArray(fns) || fns.length === 0) {
      throw new Error("parallel() expects a non-empty array of functions");
    }
    for (const fn of fns) {
      if (typeof fn === "function") continue;
      if (fn && typeof (fn as Promise<unknown>).then === "function") {
        throw new Error(
          "parallel() received a promise, not a function. Wrap the call: parallel([() => agent({...}), ...])",
        );
      }
      throw new Error("parallel() expects an array of functions");
    }
    return Promise.all((fns as Array<() => Promise<unknown>>).map((fn) => fn()));
  };

  const pipeline = async (initial: unknown, ...stages: unknown[]): Promise<unknown> => {
    let value = initial;
    for (const stage of stages) {
      if (typeof stage !== "function") {
        throw new Error("pipeline() stages must be functions: pipeline(value, (prev) => agent({...}), ...)");
      }
      value = await (stage as (prev: unknown) => Promise<unknown>)(value);
    }
    return value;
  };

  const phase = (title: unknown): void => {
    if (typeof title !== "string" || !title.trim()) {
      throw new Error("phase() expects a non-empty string title");
    }
    const previous = snapshot.phases[snapshot.phases.length - 1];
    if (previous && previous.status === "active") {
      previous.status = "done";
      previous.endedAt = Date.now();
    }
    currentPhase = title.trim();
    snapshot.phases.push({ title: currentPhase, status: "active", startedAt: Date.now() });
    emit();
  };

  const fakeConsole = {
    log: (...values: unknown[]) => pushLog("log", values),
    info: (...values: unknown[]) => pushLog("info", values),
    warn: (...values: unknown[]) => pushLog("warn", values),
    error: (...values: unknown[]) => pushLog("error", values),
  };

  const sandbox = {
    agent,
    parallel,
    pipeline,
    phase,
    args: options.args,
    console: fakeConsole,
    structuredClone: globalThis.structuredClone,
  };

  let value: unknown;
  let runError: string | undefined;
  try {
    const context = vm.createContext(Object.create(null) as Record<string, unknown>);
    Object.assign(context, sandbox);
    const factory = vm.runInContext(`(async () => {\n"use strict";\n${body}\n})`, context, {
      filename: `workflow-${meta.name}.js`,
    }) as () => Promise<unknown>;
    value = await factory();
  } catch (e) {
    runError = e instanceof Error ? e.message : String(e);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  const lastPhase = snapshot.phases[snapshot.phases.length - 1];
  if (lastPhase && lastPhase.status === "active") {
    lastPhase.status = "done";
    lastPhase.endedAt = Date.now();
  }
  snapshot.endedAt = Date.now();

  if (aborted) {
    snapshot.status = "aborted";
    snapshot.error = "Workflow was aborted";
    emit();
    return { ok: false, error: snapshot.error, snapshot };
  }
  if (runError !== undefined) {
    snapshot.status = "error";
    snapshot.error = runError;
    pushLog("error", [`workflow script failed: ${runError}`]);
    snapshot.endedAt = Date.now();
    emit();
    return { ok: false, error: runError, snapshot };
  }

  snapshot.status = "done";
  emit();
  return { ok: true, value, snapshot };
}

function emptySnapshot(meta: WorkflowMeta, status: WorkflowStatus, error: string): WorkflowSnapshot {
  const now = Date.now();
  return {
    name: meta.name,
    description: meta.description,
    status,
    phases: [],
    agents: [],
    logs: [],
    startedAt: now,
    endedAt: now,
    error,
  };
}
