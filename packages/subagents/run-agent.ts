import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import type {
  AgentMessage,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import type {
  ExtensionContext,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { resolveModel } from "@htwang-contrib/common";
import extraTools from "@htwang-contrib/extra-tools/index.ts";
import protectSecrets from "@htwang-contrib/protect-secrets/index.ts";
import webTools from "@htwang-contrib/web-tools/index.ts";
import { appendSubagentLinkRecord, SUBAGENT_SESSION_DIR } from "./paths.ts";
import {
  buildSubagentAgentCatalog,
  resolveSubagentAgentId,
  subagentSystemPromptFromCatalog,
  type SubagentAgentCatalog,
} from "./agent-catalog.ts";
import { resolveChildToolNames } from "./child-tools.ts";

const CHILD_SESSION_EXTENSION_FACTORIES: ExtensionFactory[] = [
  protectSecrets,
  extraTools,
  webTools,
];

const THINKING_LEVELS = new Set<string>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export type SubagentUsageSnapshot = {
  usage_input: number;
  usage_output: number;
  context_percent: number | null;
  context_tokens: number | null;
  context_window: number;
};

export type SubagentBatchItemDetail = {
  index: number;
  ok: boolean;
  text?: string;
  error?: string;
  tool_calls: number;
  sub_session_file?: string;
  agent_type?: string;
  description: string;
} & Partial<SubagentUsageSnapshot>;

export type SubagentRunDetails = {
  tool_calls: number;
  sub_session_file?: string;
  parent_session_id: string;
  parent_session_file: string;
  mode?: "single" | "batch";
  task_index?: number;
  task_total?: number;
  per_task_tool_calls?: number[];
  per_task_started?: boolean[];
  per_task_done?: boolean[];
  per_task_ok?: boolean[];
  per_task_usage_input?: number[];
  per_task_usage_output?: number[];
  per_task_context_percent?: (number | null)[];
  batch?: SubagentBatchItemDetail[];
  agent_type?: string;
  description?: string;
  ok?: boolean;
  error?: string;
  background?: boolean;
  background_id?: string;
} & Partial<SubagentUsageSnapshot>;

export type RunSubAgentInput = {
  task: string;
  model?: string;
  thinking?: string;
  inherit_context?: boolean;
  isolated?: boolean;
  max_turns?: number;
  stream?: { task_index: number; task_total: number };
  agent_type?: string;
};

export type RunSubAgentResult = {
  text: string;
  isError: boolean;
  errorMessage?: string;
  tool_calls: number;
  sub_session_file?: string;
  parent_session_id: string;
  parent_session_file: string;
} & SubagentUsageSnapshot;

export type SubagentChildProgress = {
  tool_calls: number;
  sub_session_file?: string;
  task_index?: number;
  task_total?: number;
} & SubagentUsageSnapshot;

function parseThinking(raw: string | undefined): ThinkingLevel | undefined {
  if (raw === undefined || raw === "") return undefined;
  const t = raw.trim().toLowerCase();
  if (!THINKING_LEVELS.has(t)) return undefined;
  return t as ThinkingLevel;
}

function extractAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const parts = msg.content;
    if (!Array.isArray(parts)) continue;
    const chunks: string[] = [];
    for (const part of parts as TextContent[]) {
      if (part.type === "text" && typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
    const joined = chunks.join("").trim();
    if (joined) return joined;
  }
  return "";
}

function resolveModelForSubagent(
  raw: string | undefined,
  ctx: ExtensionContext,
) {
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
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

const EMPTY_USAGE: SubagentUsageSnapshot = {
  usage_input: 0,
  usage_output: 0,
  context_percent: null,
  context_tokens: null,
  context_window: 0,
};

function snapshotUsage(child: AgentSession): SubagentUsageSnapshot {
  const st = child.getSessionStats();
  const cu = child.getContextUsage();
  const cw = cu?.contextWindow ?? child.model?.contextWindow ?? 0;
  return {
    usage_input: st.tokens.input,
    usage_output: st.tokens.output,
    context_percent: cu?.percent ?? null,
    context_tokens: cu?.tokens ?? null,
    context_window: cw,
  };
}

export async function runSubAgent(
  ctx: ExtensionContext,
  input: RunSubAgentInput,
  signal: AbortSignal | undefined,
  onChildProgress?: (p: SubagentChildProgress) => void,
  catalog?: SubagentAgentCatalog,
): Promise<RunSubAgentResult> {
  const parentHeader = ctx.sessionManager.getHeader();
  const parentSessionId = parentHeader?.id ?? "unknown";
  const parentSessionFile = ctx.sessionManager.getSessionFile() ?? "";

  let session: AgentSession | undefined;
  let toolCallCount = 0;

  const finish = (
    partial: Omit<
      RunSubAgentResult,
      "parent_session_id" | "parent_session_file" | keyof SubagentUsageSnapshot
    > &
      Partial<
        Pick<RunSubAgentResult, "parent_session_id" | "parent_session_file"> &
          SubagentUsageSnapshot
      >,
  ): RunSubAgentResult => {
    const u = session ? snapshotUsage(session) : EMPTY_USAGE;
    return {
      parent_session_id: partial.parent_session_id ?? parentSessionId,
      parent_session_file: partial.parent_session_file ?? parentSessionFile,
      tool_calls: partial.tool_calls ?? toolCallCount,
      sub_session_file:
        partial.sub_session_file ?? session?.sessionManager.getSessionFile(),
      text: partial.text,
      isError: partial.isError,
      errorMessage: partial.errorMessage,
      usage_input: partial.usage_input ?? u.usage_input,
      usage_output: partial.usage_output ?? u.usage_output,
      context_percent: partial.context_percent ?? u.context_percent,
      context_tokens: partial.context_tokens ?? u.context_tokens,
      context_window: partial.context_window ?? u.context_window,
    };
  };

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
    if (input.inherit_context) {
      const sys = ctx.getSystemPrompt();
      const head = sys.length > 12_000 ? `${sys.slice(0, 12_000)}\n…` : sys;
      effectiveTask = `The parent agent session provided the following system prompt context (truncated):\n\n${head}\n\n---\n\nYour assignment:\n\n${effectiveTask}`;
    }

    const isolated = input.isolated !== false;
    const cwd = ctx.cwd;
    const agentCatalog = catalog ?? buildSubagentAgentCatalog(cwd);
    const agentType = resolveSubagentAgentId(input.agent_type, agentCatalog);
    const personaTools = agentCatalog.agents.get(agentType)?.fileOptions.tools;
    const toolList = resolveChildToolNames(isolated, personaTools);

    const systemPrompt = subagentSystemPromptFromCatalog(
      agentType,
      agentCatalog,
    );
    const agentDir = getAgentDir();
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const model = resolveModelForSubagent(input.model, ctx);
    const thinkingLevel = parseThinking(input.thinking);

    fs.mkdirSync(SUBAGENT_SESSION_DIR, { recursive: true });

    const newOpts: { id: string; parentSession?: string } = {
      id: randomUUID(),
    };
    if (parentHeader?.id) {
      newOpts.parentSession = parentHeader.id;
    }

    const sessionManager = SessionManager.create(
      cwd,
      SUBAGENT_SESSION_DIR,
      newOpts,
    );

    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      extensionFactories: CHILD_SESSION_EXTENSION_FACTORIES,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPromptOverride: () => systemPrompt,
      appendSystemPromptOverride: () => [],
    });
    await loader.reload();

    const { session: created } = await createAgentSession({
      cwd,
      agentDir,
      modelRegistry: ctx.modelRegistry,
      model,
      thinkingLevel,
      tools: toolList,
      resourceLoader: loader,
      sessionManager,
      settingsManager,
    });
    session = created;

    await created.bindExtensions({});

    const maxTurns = input.max_turns;
    const grace = 3;
    let turnCount = 0;
    let soft = false;

    const emitProgress = () => {
      const u = snapshotUsage(created);
      onChildProgress?.({
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

    try {
      await created.prompt(effectiveTask);
    } finally {
      unsub();
      cleanupAbort();
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

    return finish({ text, isError: false, tool_calls: toolCallCount });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return finish({
      text: "",
      isError: true,
      errorMessage: msg,
      tool_calls: toolCallCount,
    });
  } finally {
    const subFile = session?.sessionManager.getSessionFile();
    if (subFile) {
      appendSubagentLinkRecord(parentSessionId, {
        parent_session_file: parentSessionFile,
        sub_session_file: subFile,
        tool_calls: toolCallCount,
        ended_at: new Date().toISOString(),
      });
    }
  }
}
