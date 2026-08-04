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

export type RunWorkflowOptions = {
  args?: unknown;
  signal?: AbortSignal;
  runAgent: WorkflowAgentRunner;
  maxConcurrency: number;
  maxAgents: number;
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

  const agent = async (call: WorkflowAgentCall): Promise<unknown> => {
    if (!call || typeof call !== "object") {
      throw new Error("agent() expects a single options object");
    }
    if (typeof call.label !== "string" || !call.label.trim()) {
      throw new Error("agent() requires a non-empty string `label`");
    }
    if (typeof call.task !== "string" || !call.task.trim()) {
      throw new Error(`agent("${call.label}") requires a non-empty string \`task\``);
    }
    if (call.schema !== undefined) {
      if (typeof call.schema !== "object" || call.schema === null || Array.isArray(call.schema)) {
        throw new Error(`agent("${call.label}"): schema must be a JSON Schema object`);
      }
      if (call.schema.type !== "object") {
        throw new Error(`agent("${call.label}"): schema must have type: "object" at the top level`);
      }
    }
    agentSeq += 1;
    if (agentSeq > maxAgents) {
      throw new Error(`workflow agent limit exceeded: more than ${maxAgents} agent() calls`);
    }

    const entry: WorkflowAgentSnapshot = {
      id: agentSeq,
      label: call.label.trim(),
      phase: currentPhase,
      status: "queued",
      toolCalls: 0,
      startedAt: Date.now(),
    };
    snapshot.agents.push(entry);
    emit();

    await semaphore.acquire();
    try {
      if (aborted) {
        entry.status = "aborted";
        entry.endedAt = Date.now();
        return null;
      }
      entry.status = "running";
      emit();
      const result = await options.runAgent(call, {
        signal,
        onProgress: (toolCalls) => {
          entry.toolCalls = toolCalls;
          emit();
        },
      });
      if (result.ok) {
        entry.status = "done";
        return result.value !== undefined ? result.value : (result.text ?? null);
      }
      entry.status = aborted ? "aborted" : "error";
      entry.detail = result.error;
      pushLog("error", [`agent("${entry.label}") failed: ${result.error ?? "unknown error"}`]);
      return null;
    } catch (e) {
      entry.status = aborted ? "aborted" : "error";
      entry.detail = e instanceof Error ? e.message : String(e);
      pushLog("error", [`agent("${entry.label}") threw: ${entry.detail}`]);
      return null;
    } finally {
      entry.endedAt = Date.now();
      semaphore.release();
      emit();
    }
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
