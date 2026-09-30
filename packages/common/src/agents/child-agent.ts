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
import { loadSubagentModelConfig, resolveSubagentModelPattern } from "./subagent-models.ts";

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

  const finish = (
    partial: Omit<RunChildAgentResult, "parent_session_id" | "parent_session_file" | keyof ChildAgentUsageSnapshot> &
      Partial<Pick<RunChildAgentResult, "parent_session_id" | "parent_session_file"> & ChildAgentUsageSnapshot>,
  ): RunChildAgentResult => {
    const u = session ? snapshotUsage(session) : EMPTY_USAGE;
    return {
      parent_session_id: partial.parent_session_id ?? parentSessionId,
      parent_session_file: partial.parent_session_file ?? parentSessionFile,
      tool_calls: partial.tool_calls ?? toolCallCount,
      sub_session_file: partial.sub_session_file ?? session?.sessionManager.getSessionFile(),
      text: partial.text,
      value: partial.value,
      isError: partial.isError,
      errorMessage: partial.errorMessage,
      usage_input: partial.usage_input ?? u.usage_input,
      usage_output: partial.usage_output ?? u.usage_output,
      usage_cache_read: partial.usage_cache_read ?? u.usage_cache_read,
      usage_cache_write: partial.usage_cache_write ?? u.usage_cache_write,
      usage_cost_usd: partial.usage_cost_usd ?? u.usage_cost_usd,
      context_percent: partial.context_percent ?? u.context_percent,
      context_tokens: partial.context_tokens ?? u.context_tokens,
      context_window: partial.context_window ?? u.context_window,
    };
  };

  // Setup failures throw: pi marks a tool call failed only when execute throws,
  // and a returned isError flag is discarded — a spawn that never started must
  // not read as an agent that ran and reported a problem (upstream #179).
  // Callers that need per-item error results (batch) catch and convert.
  try {
    let effectiveTask = input.task.trim();
    if (!effectiveTask) {
      return finish({
        text: "",
        isError: true,
        errorMessage: "task is empty",
        tool_calls: 0,
      });
    }
    if (signal?.aborted) {
      return finish({
        text: "",
        isError: true,
        errorMessage: "Operation aborted",
        tool_calls: 0,
      });
    }
    const cwd = ctx.cwd;
    const agentCatalog = input.catalog ?? buildAgentPersonaCatalog(cwd);
    const agentType = resolvePersonaId(input.agent_type, agentCatalog);
    const fileOptions = agentCatalog.agents.get(agentType)?.fileOptions ?? {};
    const modelConfig = loadSubagentModelConfig();
    const opts = resolveEffectiveChildOptions(
      input,
      fileOptions,
      personaDefaultsForType(readPersonaDefaultsByType(), agentType),
      modelConfig.agentModels[agentType],
    );

    if (opts.inherit_context) {
      const sys = ctx.getSystemPrompt();
      const head = sys.length > 12_000 ? `${sys.slice(0, 12_000)}\n…` : sys;
      effectiveTask = `The parent agent session provided the following system prompt context (truncated):\n\n${head}\n\n---\n\nYour assignment:\n\n${effectiveTask}`;
    }

    const personaTools = fileOptions.tools;

    const structured = input.outputSchema ? createStructuredOutputTool(input.outputSchema) : undefined;
    const toolList = resolveChildToolNames(opts.isolated, personaTools);
    if (structured) toolList.push(STRUCTURED_OUTPUT_TOOL_NAME);

    let systemPrompt = personaSystemPrompt(agentType, agentCatalog);
    if (structured) {
      systemPrompt += `\n\nWhen you have completed the assignment, call the \`${STRUCTURED_OUTPUT_TOOL_NAME}\` tool exactly once with your final result matching the tool's parameter schema. Do not end the session with a plain-text summary; the tool call is the only accepted final answer.`;
    }

    const agentDir = getAgentDir();
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const model = resolveModelForChild(resolveSubagentModelPattern(opts.model, modelConfig.modelTiers), ctx);
    const thinkingLevel = parseThinking(opts.thinking);

    fs.mkdirSync(input.sessionDir, { recursive: true });

    const newOpts: { id: string; parentSession?: string } = {
      id: randomUUID(),
    };
    if (parentHeader?.id) {
      newOpts.parentSession = parentHeader.id;
    }

    const sessionManager = SessionManager.create(cwd, input.sessionDir, newOpts);

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
      systemPromptOverride: () => systemPrompt,
      appendSystemPromptOverride: () => [],
    });
    await loader.reload();

    const modelRuntime = await ModelRuntime.create();
    const { session: created } = await createAgentSession({
      cwd,
      agentDir,
      modelRuntime,
      model,
      thinkingLevel,
      tools: toolList,
      customTools: structured ? [structured.tool] : undefined,
      resourceLoader: loader,
      sessionManager,
      settingsManager,
    });
    session = created;

    recordChildSessionStarted(parentSessionId, {
      parentSessionFile,
      childSessionFile: created.sessionManager.getSessionFile() ?? "",
    });

    await created.bindExtensions({});

    const maxTurns = opts.max_turns;
    const grace = 3;
    let turnCount = 0;
    let soft = false;

    const emitProgress = () => {
      const u = snapshotUsage(created);
      input.onProgress?.({
        tool_calls: toolCallCount,
        sub_session_file: created.sessionManager.getSessionFile(),
        ...(input.stream
          ? {
              task_index: input.stream.task_index,
              task_total: input.stream.task_total,
            }
          : {}),
        ...u,
      });
    };

    const unsub = created.subscribe((event: AgentSessionEvent) => {
      if (event.type === "tool_execution_end") {
        toolCallCount += 1;
        emitProgress();
        return;
      }
      if (event.type !== "turn_end") return;
      emitProgress();
      if (maxTurns === undefined || maxTurns <= 0) return;
      turnCount += 1;
      if (!soft && turnCount >= maxTurns) {
        soft = true;
        void created.steer(
          "You have reached the turn limit. Finish now with a short final answer; do not start new tool work.",
        );
      } else if (soft && turnCount >= maxTurns + grace) {
        void created.abort();
      }
    });

    const cleanupAbort = forwardAbort(created, signal);

    emitProgress();

    // The run phase: failures here settle on the result, never throw.
    try {
      try {
        await created.prompt(effectiveTask);
      } finally {
        unsub();
        cleanupAbort();
      }

      if (structured) {
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return finish({
        text: "",
        isError: true,
        errorMessage: msg,
        tool_calls: toolCallCount,
      });
    }
  } finally {
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
}
