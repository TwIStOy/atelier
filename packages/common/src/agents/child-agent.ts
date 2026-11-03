import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
  type AgentSession,
  type AgentSessionEvent,
  createAgentSession,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  DefaultResourceLoader,
  defineTool,
  formatSize,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { resolveModel } from "../model-resolve.ts";
import {
  type AgentPersonaCatalog,
  type AgentPersonaFileOptions,
  buildAgentPersonaCatalog,
  personaSystemPrompt,
  resolvePersonaId,
} from "./agent-personas.ts";
import { getChildExtensionFactories } from "./child-extensions.ts";
import { resolveChildToolNames } from "./child-tools.ts";
import { type PersonaTypeDefaults, personaDefaultsForType, readPersonaDefaultsByType } from "./persona-defaults.ts";
import { recordChildSessionFinished, recordChildSessionStarted } from "./session-links.ts";
import { shutdownChildSession } from "./session-shutdown.ts";
import { loadSubagentModelConfig, resolveSubagentModelPattern, type SubagentModelConfig } from "./subagent-models.ts";

export const STRUCTURED_OUTPUT_TOOL_NAME = "structured_output";

const THINKING_LEVELS = new Set<string>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export type ChildAgentUsageSnapshot = {
  usage_input: number;
  usage_output: number;
  usage_cache_read?: number;
  usage_cache_write?: number;
  usage_cost_usd?: number;
  context_percent: number | null;
  context_tokens: number | null;
  context_window: number;
};

export type ChildAgentProgress = {
  tool_calls: number;
  sub_session_file?: string;
  task_index?: number;
  task_total?: number;
} & ChildAgentUsageSnapshot;

export type RunChildAgentInput = {
  task: string;
  model?: string;
  thinking?: string;
  inherit_context?: boolean;
  isolated?: boolean;
  max_turns?: number;
  agent_type?: string;
  catalog?: AgentPersonaCatalog;
  extensionFactories?: ExtensionFactory[];
  sessionDir: string;
  outputSchema?: TSchema;
  stream?: { task_index: number; task_total: number };
  onProgress?: (p: ChildAgentProgress) => void;
};

export type RunChildAgentResult = {
  text: string;
  value?: unknown;
  isError: boolean;
  errorMessage?: string;
  tool_calls: number;
  sub_session_file?: string;
  parent_session_id: string;
  parent_session_file: string;
} & ChildAgentUsageSnapshot;

export function parseThinking(raw: string | undefined): ThinkingLevel | undefined {
  if (raw === undefined || raw === "") return undefined;
  const t = raw.trim().toLowerCase();
  if (!THINKING_LEVELS.has(t)) return undefined;
  return t as ThinkingLevel;
}

export function assistantMessageText(msg: AgentMessage): string {
  if (msg.role !== "assistant") return "";
  const chunks: string[] = [];
  for (const part of msg.content) {
    if (part.type === "text" && typeof part.text === "string") chunks.push(part.text);
  }
  return chunks.join("").trim();
}

export function extractAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const text = assistantMessageText(msg);
    if (text) return text;
  }
  return "";
}

export function finalTurnError(messages: AgentMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    if (msg.stopReason === "error") {
      return msg.errorMessage?.trim() || "provider error with no output";
    }
    if (msg.stopReason === "length" && assistantMessageText(msg) === "") {
      return "hit output token limit without producing any text";
    }
    return undefined;
  }
  return undefined;
}

export type EffectiveChildOptions = {
  model?: string;
  thinking?: string;
  inherit_context: boolean;
  isolated: boolean;
  max_turns?: number;
};

export function resolveEffectiveChildOptions(
  input: Pick<RunChildAgentInput, "model" | "thinking" | "inherit_context" | "isolated" | "max_turns">,
  fileOptions: AgentPersonaFileOptions,
  personaDefaults: PersonaTypeDefaults,
  configuredModel?: string,
): EffectiveChildOptions {
  return {
    model: input.model ?? configuredModel ?? fileOptions.model ?? personaDefaults.model,
    thinking: input.thinking ?? fileOptions.thinking ?? personaDefaults.thinking,
    inherit_context: input.inherit_context ?? fileOptions.inherit_context ?? false,
    isolated: input.isolated ?? fileOptions.isolated ?? true,
    max_turns: input.max_turns ?? fileOptions.max_turns,
  };
}

function createStructuredOutputTool(schema: TSchema) {
  let captured: unknown;
  let wasCalled = false;
  const tool = defineTool({
    name: STRUCTURED_OUTPUT_TOOL_NAME,
    label: "Structured Output",
    description:
      "Submit the final structured result for this assignment. Calling this tool ends the session; it is the only accepted way to deliver the final answer.",
    parameters: schema,
    async execute(_toolCallId, params) {
      captured = params;
      wasCalled = true;
      return {
        content: [{ type: "text", text: "Result submitted." }],
        details: {},
        terminate: true,
      };
    },
  });
  return {
    tool,
    get captured(): unknown {
      return captured;
    },
    get wasCalled(): boolean {
      return wasCalled;
    },
  };
}

function resolveModelForChild(raw: string | undefined, ctx: ExtensionContext) {
  const pattern = raw?.trim();
  if (!pattern) return ctx.model;
  const found = resolveModel(ctx.modelRegistry.getAvailable(), pattern);
  return found ?? ctx.model;
}

function forwardAbort(session: AgentSession, signal: AbortSignal | undefined) {
  if (!signal) return () => {};
  const onAbort = () => {
    void session.abort();
  };
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

const EMPTY_USAGE: ChildAgentUsageSnapshot = {
  usage_input: 0,
  usage_output: 0,
  usage_cache_read: 0,
  usage_cache_write: 0,
  usage_cost_usd: 0,
  context_percent: null,
  context_tokens: null,
  context_window: 0,
};

function snapshotUsage(child: AgentSession): ChildAgentUsageSnapshot {
  const st = child.getSessionStats();
  const cu = child.getContextUsage();
  const cw = cu?.contextWindow ?? child.model?.contextWindow ?? 0;
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

type ChildResultPartial = Omit<
  RunChildAgentResult,
  "parent_session_id" | "parent_session_file" | keyof ChildAgentUsageSnapshot
> &
  Partial<Pick<RunChildAgentResult, "parent_session_id" | "parent_session_file"> & ChildAgentUsageSnapshot>;

function mergedUsageSnapshot(partial: ChildResultPartial, base: ChildAgentUsageSnapshot): ChildAgentUsageSnapshot {
  return {
    usage_input: partial.usage_input ?? base.usage_input,
    usage_output: partial.usage_output ?? base.usage_output,
    usage_cache_read: partial.usage_cache_read ?? base.usage_cache_read,
    usage_cache_write: partial.usage_cache_write ?? base.usage_cache_write,
    usage_cost_usd: partial.usage_cost_usd ?? base.usage_cost_usd,
    context_percent: partial.context_percent ?? base.context_percent,
    context_tokens: partial.context_tokens ?? base.context_tokens,
    context_window: partial.context_window ?? base.context_window,
  };
}

function buildChildResult(
  partial: ChildResultPartial,
  session: AgentSession | undefined,
  toolCallCount: number,
  parentSessionId: string,
  parentSessionFile: string,
): RunChildAgentResult {
  const base = session ? snapshotUsage(session) : EMPTY_USAGE;
  return {
    parent_session_id: partial.parent_session_id ?? parentSessionId,
    parent_session_file: partial.parent_session_file ?? parentSessionFile,
    tool_calls: partial.tool_calls ?? toolCallCount,
    sub_session_file: partial.sub_session_file ?? session?.sessionManager.getSessionFile(),
    text: partial.text,
    value: partial.value,
    isError: partial.isError,
    errorMessage: partial.errorMessage,
    ...mergedUsageSnapshot(partial, base),
  };
}

function childTaskError(task: string, signal: AbortSignal | undefined): string | undefined {
  if (task.trim() === "") return "task is empty";
  if (signal?.aborted) return "Operation aborted";
  return undefined;
}

type StructuredOutputTool = ReturnType<typeof createStructuredOutputTool>;

type ChildAgentSetup = {
  opts: EffectiveChildOptions;
  effectiveTask: string;
  structured: StructuredOutputTool | undefined;
  toolList: string[];
  systemPrompt: string;
  modelConfig: SubagentModelConfig;
};

function composeEffectiveTask(task: string, opts: EffectiveChildOptions, ctx: ExtensionContext): string {
  if (!opts.inherit_context) return task;
  const sys = ctx.getSystemPrompt();
  const head = sys.length > 12_000 ? `${sys.slice(0, 12_000)}\n…` : sys;
  return `The parent agent session provided the following system prompt context (truncated):\n\n${head}\n\n---\n\nYour assignment:\n\n${task}`;
}

function buildChildSystemPrompt(agentType: string, agentCatalog: AgentPersonaCatalog, structured: boolean): string {
  const systemPrompt = personaSystemPrompt(agentType, agentCatalog);
  if (!structured) return systemPrompt;
  return `${systemPrompt}\n\nWhen you have completed the assignment, call the \`${STRUCTURED_OUTPUT_TOOL_NAME}\` tool exactly once with your final result matching the tool's parameter schema. Do not end the session with a plain-text summary; the tool call is the only accepted final answer.`;
}

function buildChildTooling(
  input: RunChildAgentInput,
  agentType: string,
  agentCatalog: AgentPersonaCatalog,
  personaTools: string[] | undefined,
  opts: EffectiveChildOptions,
): { structured: StructuredOutputTool | undefined; toolList: string[]; systemPrompt: string } {
  const structured = input.outputSchema ? createStructuredOutputTool(input.outputSchema) : undefined;
  const toolList = resolveChildToolNames(opts.isolated, personaTools);
  if (structured) toolList.push(STRUCTURED_OUTPUT_TOOL_NAME);
  const systemPrompt = buildChildSystemPrompt(agentType, agentCatalog, structured !== undefined);
  return { structured, toolList, systemPrompt };
}

function resolveChildSetup(ctx: ExtensionContext, input: RunChildAgentInput): ChildAgentSetup {
  const agentCatalog = input.catalog ?? buildAgentPersonaCatalog(ctx.cwd);
  const agentType = resolvePersonaId(input.agent_type, agentCatalog);
  const fileOptions = agentCatalog.agents.get(agentType)?.fileOptions ?? {};
  const modelConfig = loadSubagentModelConfig();
  const opts = resolveEffectiveChildOptions(
    input,
    fileOptions,
    personaDefaultsForType(readPersonaDefaultsByType(), agentType),
    modelConfig.agentModels[agentType],
  );
  const { structured, toolList, systemPrompt } = buildChildTooling(
    input,
    agentType,
    agentCatalog,
    fileOptions.tools,
    opts,
  );
  const effectiveTask = composeEffectiveTask(input.task.trim(), opts, ctx);
  return { opts, effectiveTask, structured, toolList, systemPrompt, modelConfig };
}

type ParentSessionHeader = ReturnType<ExtensionContext["sessionManager"]["getHeader"]>;

function childSessionOptions(parentSessionId: string | undefined): { id: string; parentSession?: string } {
  const newOpts: { id: string; parentSession?: string } = { id: randomUUID() };
  if (parentSessionId) {
    newOpts.parentSession = parentSessionId;
  }
  return newOpts;
}

async function spawnChildSession(
  ctx: ExtensionContext,
  input: RunChildAgentInput,
  setup: ChildAgentSetup,
  parentHeader: ParentSessionHeader,
): Promise<AgentSession> {
  const cwd = ctx.cwd;
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const model = resolveModelForChild(resolveSubagentModelPattern(setup.opts.model, setup.modelConfig.modelTiers), ctx);
  const thinkingLevel = parseThinking(setup.opts.thinking);

  fs.mkdirSync(input.sessionDir, { recursive: true });

  const sessionManager = SessionManager.create(cwd, input.sessionDir, childSessionOptions(parentHeader?.id));

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    extensionFactories: [...(input.extensionFactories ?? []), ...getChildExtensionFactories()],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => setup.systemPrompt,
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  const modelRuntime = await ModelRuntime.create();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model,
    thinkingLevel,
    tools: setup.toolList,
    customTools: setup.structured ? [setup.structured.tool] : undefined,
    resourceLoader: loader,
    sessionManager,
    settingsManager,
  });
  return session;
}

async function activateChildSession(
  created: AgentSession,
  parentSessionId: string,
  parentSessionFile: string,
): Promise<void> {
  recordChildSessionStarted(parentSessionId, {
    parentSessionFile,
    childSessionFile: created.sessionManager.getSessionFile() ?? "",
  });
  await created.bindExtensions({});
}

type TurnLimitState = { count: number; soft: boolean };

function applyTurnLimitAction(state: TurnLimitState, created: AgentSession, maxTurns: number, grace: number): void {
  if (!state.soft && state.count >= maxTurns) {
    state.soft = true;
    void created.steer(
      "You have reached the turn limit. Finish now with a short final answer; do not start new tool work.",
    );
    return;
  }
  if (state.soft && state.count >= maxTurns + grace) {
    void created.abort();
  }
}

function enforceTurnLimit(
  state: TurnLimitState,
  created: AgentSession,
  maxTurns: number | undefined,
  grace: number,
): void {
  if (maxTurns === undefined || maxTurns <= 0) return;
  state.count += 1;
  applyTurnLimitAction(state, created, maxTurns, grace);
}

type ToolCallCounter = { count: number };

function childProgressPayload(
  created: AgentSession,
  input: RunChildAgentInput,
  usage: ChildAgentUsageSnapshot,
  toolCallCount: number,
): ChildAgentProgress {
  return {
    tool_calls: toolCallCount,
    sub_session_file: created.sessionManager.getSessionFile(),
    ...(input.stream
      ? {
          task_index: input.stream.task_index,
          task_total: input.stream.task_total,
        }
      : {}),
    ...usage,
  };
}

type ChildSessionObserver = { unsub: () => void; emitProgress: () => void };

function observeChildSession(
  created: AgentSession,
  input: RunChildAgentInput,
  toolCalls: ToolCallCounter,
  maxTurns: number | undefined,
): ChildSessionObserver {
  const grace = 3;
  const turnLimit: TurnLimitState = { count: 0, soft: false };
  const emitProgress = () => {
    const u = snapshotUsage(created);
    input.onProgress?.(childProgressPayload(created, input, u, toolCalls.count));
  };
  const unsub = created.subscribe((event: AgentSessionEvent) => {
    if (event.type === "tool_execution_end") {
      toolCalls.count += 1;
      emitProgress();
      return;
    }
    if (event.type !== "turn_end") return;
    emitProgress();
    enforceTurnLimit(turnLimit, created, maxTurns, grace);
  });
  return { unsub, emitProgress };
}

async function runChildPrompt(
  created: AgentSession,
  task: string,
  unsub: () => void,
  cleanupAbort: () => void,
): Promise<void> {
  try {
    await created.prompt(task);
  } finally {
    unsub();
    cleanupAbort();
  }
}

function structuredChildResult(
  structured: StructuredOutputTool,
  created: AgentSession,
  toolCallCount: number,
  finish: (partial: ChildResultPartial) => RunChildAgentResult,
): RunChildAgentResult {
  if (!structured.wasCalled) {
    return finish({
      text: extractAssistantText(created.messages),
      isError: true,
      errorMessage: `child agent ended without calling ${STRUCTURED_OUTPUT_TOOL_NAME}`,
      tool_calls: toolCallCount,
    });
  }
  const failure = finalTurnError(created.messages);
  return finish({
    text: JSON.stringify(structured.captured, null, 2),
    value: structured.captured,
    isError: Boolean(failure),
    errorMessage: failure,
    tool_calls: toolCallCount,
  });
}

function plainChildResult(
  created: AgentSession,
  toolCallCount: number,
  finish: (partial: ChildResultPartial) => RunChildAgentResult,
): RunChildAgentResult {
  const raw = extractAssistantText(created.messages);
  const trunc = truncateHead(raw, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  let text = trunc.content;
  if (trunc.truncated) {
    text += `\n\n[Output truncated: ${trunc.outputLines} of ${trunc.totalLines} lines (${formatSize(trunc.outputBytes)} of ${formatSize(trunc.totalBytes)}).]`;
  }
  const failure = finalTurnError(created.messages);
  return finish({
    text,
    isError: Boolean(failure),
    errorMessage: failure,
    tool_calls: toolCallCount,
  });
}

async function settleChildSession(
  session: AgentSession | undefined,
  parentSessionId: string,
  parentSessionFile: string,
  toolCallCount: number,
): Promise<void> {
  const subFile = session?.sessionManager.getSessionFile();
  if (subFile) {
    recordChildSessionFinished(parentSessionId, {
      parentSessionFile,
      childSessionFile: subFile,
      toolCalls: toolCallCount,
    });
  }
  await shutdownChildSession(session);
}

export async function runChildAgent(
  ctx: ExtensionContext,
  input: RunChildAgentInput,
  signal: AbortSignal | undefined,
): Promise<RunChildAgentResult> {
  const parentHeader = ctx.sessionManager.getHeader();
  const parentSessionId = parentHeader?.id ?? "unknown";
  const parentSessionFile = ctx.sessionManager.getSessionFile() ?? "";

  let session: AgentSession | undefined;
  const toolCalls: ToolCallCounter = { count: 0 };

  const finish = (partial: ChildResultPartial): RunChildAgentResult =>
    buildChildResult(partial, session, toolCalls.count, parentSessionId, parentSessionFile);

  // Setup failures throw: pi marks a tool call failed only when execute throws,
  // and a returned isError flag is discarded — a spawn that never started must
  // not read as an agent that ran and reported a problem (upstream #179).
  // Callers that need per-item error results (batch) catch and convert.
  try {
    const earlyError = childTaskError(input.task, signal);
    if (earlyError) {
      return finish({ text: "", isError: true, errorMessage: earlyError, tool_calls: 0 });
    }

    const setup = resolveChildSetup(ctx, input);
    const created = await spawnChildSession(ctx, input, setup, parentHeader);
    session = created;
    await activateChildSession(created, parentSessionId, parentSessionFile);

    const { unsub, emitProgress } = observeChildSession(created, input, toolCalls, setup.opts.max_turns);
    const cleanupAbort = forwardAbort(created, signal);
    emitProgress();

    // The run phase: failures here settle on the result, never throw.
    try {
      await runChildPrompt(created, setup.effectiveTask, unsub, cleanupAbort);
      if (setup.structured) {
        return structuredChildResult(setup.structured, created, toolCalls.count, finish);
      }
      return plainChildResult(created, toolCalls.count, finish);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return finish({ text: "", isError: true, errorMessage: msg, tool_calls: toolCalls.count });
    }
  } finally {
    await settleChildSession(session, parentSessionId, parentSessionFile, toolCalls.count);
  }
}
