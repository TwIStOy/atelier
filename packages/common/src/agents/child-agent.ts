import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AgentSession, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  defineTool,
  formatSize,
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
import { type ChildSessionUsage, childUsageSnapshot, type EngineProgress, withChildSession } from "./child-session.ts";
import { resolveChildToolNames } from "./child-tools.ts";
import { type PersonaTypeDefaults, personaDefaultsForType, readPersonaDefaultsByType } from "./persona-defaults.ts";
import { loadSubagentModelConfig, resolveSubagentModelPattern, type SubagentModelConfig } from "./subagent-models.ts";

export const STRUCTURED_OUTPUT_TOOL_NAME = "structured_output";

const THINKING_LEVELS = new Set<string>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export type ChildAgentUsageSnapshot = ChildSessionUsage;

export type ChildAgentProgress = EngineProgress;

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
  usage: ChildAgentUsageSnapshot,
): RunChildAgentResult {
  return {
    parent_session_id: partial.parent_session_id ?? parentSessionId,
    parent_session_file: partial.parent_session_file ?? parentSessionFile,
    tool_calls: partial.tool_calls ?? toolCallCount,
    sub_session_file: partial.sub_session_file ?? session?.sessionManager.getSessionFile(),
    text: partial.text,
    value: partial.value,
    isError: partial.isError,
    errorMessage: partial.errorMessage,
    ...mergedUsageSnapshot(partial, usage),
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

export async function runChildAgent(
  ctx: ExtensionContext,
  input: RunChildAgentInput,
  signal: AbortSignal | undefined,
): Promise<RunChildAgentResult> {
  const parentHeader = ctx.sessionManager.getHeader();
  const parentSessionId = parentHeader?.id ?? "unknown";
  const parentSessionFile = ctx.sessionManager.getSessionFile() ?? "";

  let session: AgentSession | undefined;
  let toolCallCount = 0;
  const finish = (partial: ChildResultPartial): RunChildAgentResult =>
    buildChildResult(
      partial,
      session,
      toolCallCount,
      parentSessionId,
      parentSessionFile,
      session ? childUsageSnapshot(session) : EMPTY_USAGE,
    );

  // Setup failures throw: pi marks a tool call failed only when execute throws,
  // and a returned isError flag is discarded — a spawn that never started must
  // not read as an agent that ran and reported a problem (upstream #179).
  // Callers that need per-item error results (batch) catch and convert.
  const earlyError = childTaskError(input.task, signal);
  if (earlyError) {
    return finish({ text: "", isError: true, errorMessage: earlyError, tool_calls: 0 });
  }

  const setup = resolveChildSetup(ctx, input);
  const model = resolveModelForChild(resolveSubagentModelPattern(setup.opts.model, setup.modelConfig.modelTiers), ctx);

  return withChildSession(
    ctx,
    {
      sessionDir: input.sessionDir,
      systemPrompt: setup.systemPrompt,
      tools: setup.toolList,
      customTools: setup.structured ? [setup.structured.tool] : undefined,
      model,
      thinkingLevel: parseThinking(setup.opts.thinking),
      extensionFactories: input.extensionFactories,
      maxTurns: setup.opts.max_turns,
      signal,
      onProgress: input.onProgress,
      progressContext: input.stream
        ? { task_index: input.stream.task_index, task_total: input.stream.task_total }
        : undefined,
    },
    async (h) => {
      session = h.session;
      // The run phase: failures here settle on the result, never throw.
      try {
        await h.session.prompt(setup.effectiveTask);
        toolCallCount = h.toolCallCount();
        if (setup.structured) {
          return structuredChildResult(setup.structured, h.session, toolCallCount, finish);
        }
        return plainChildResult(h.session, toolCallCount, finish);
      } catch (e) {
        toolCallCount = h.toolCallCount();
        const msg = e instanceof Error ? e.message : String(e);
        return finish({ text: "", isError: true, errorMessage: msg, tool_calls: toolCallCount });
      }
    },
  );
}
