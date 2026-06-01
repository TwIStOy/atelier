import type {
  AgentMessage,
  AgentToolUpdateCallback,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
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

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"] as const;
const FULL_BUILTIN_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;

const THINKING_LEVELS = new Set<string>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

const SUBAGENT_SYSTEM =
  "You are a focused sub-agent running inside the same Pi process. Use your tools to complete the assignment. When done, reply with a concise final summary for the parent agent.";

export type RunInProcessAgentInput = {
  task: string;
  model?: string;
  thinking?: string;
  inherit_context?: boolean;
  isolated?: boolean;
  max_turns?: number;
};

export type RunInProcessAgentResult = {
  text: string;
  isError: boolean;
  errorMessage?: string;
};

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

function resolveModelFromString(
  raw: string | undefined,
  ctx: ExtensionContext,
) {
  if (!raw?.trim()) return ctx.model;
  const s = raw.trim();
  const slash = s.indexOf("/");
  if (slash <= 0 || slash === s.length - 1) return ctx.model;
  const provider = s.slice(0, slash);
  const modelId = s.slice(slash + 1);
  return ctx.modelRegistry.find(provider, modelId) ?? ctx.model;
}

function forwardAbort(session: AgentSession, signal: AbortSignal | undefined) {
  if (!signal) return () => {};
  const onAbort = () => {
    void session.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

export async function runInProcessAgent(
  ctx: ExtensionContext,
  input: RunInProcessAgentInput,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<unknown> | undefined,
): Promise<RunInProcessAgentResult> {
  const isolated = input.isolated !== false;
  const toolList = isolated ? [...READ_ONLY_TOOLS] : [...FULL_BUILTIN_TOOLS];

  const cwd = ctx.cwd;
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const model = resolveModelFromString(input.model, ctx);
  const thinkingLevel = parseThinking(input.thinking);

  let effectiveTask = input.task.trim();
  if (!effectiveTask) {
    return { text: "", isError: true, errorMessage: "task is empty" };
  }
  if (input.inherit_context) {
    const sys = ctx.getSystemPrompt();
    const head = sys.length > 12_000 ? `${sys.slice(0, 12_000)}\n…` : sys;
    effectiveTask = `The parent agent session provided the following system prompt context (truncated):\n\n${head}\n\n---\n\nYour assignment:\n\n${effectiveTask}`;
  }

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => SUBAGENT_SYSTEM,
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRegistry: ctx.modelRegistry,
    model,
    thinkingLevel,
    tools: [...toolList],
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
  });

  await session.bindExtensions({});

  const maxTurns = input.max_turns;
  const grace = 3;
  let turnCount = 0;
  let soft = false;

  let streamed = "";
  const unsub = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "message_update") {
      if (event.assistantMessageEvent.type === "text_delta") {
        streamed += event.assistantMessageEvent.delta;
        const snap =
          streamed.length > 8000 ? `${streamed.slice(0, 8000)}…` : streamed;
        onUpdate?.({
          content: [{ type: "text", text: snap }],
          details: {},
        });
      }
      return;
    }
    if (event.type !== "turn_end") return;
    if (maxTurns === undefined || maxTurns <= 0) return;
    turnCount += 1;
    if (!soft && turnCount >= maxTurns) {
      soft = true;
      void session.steer(
        "You have reached the turn limit. Finish now with a short final answer; do not start new tool work.",
      );
    } else if (soft && turnCount >= maxTurns + grace) {
      void session.abort();
    }
  });

  const cleanupAbort = forwardAbort(session, signal);

  try {
    await session.prompt(effectiveTask);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { text: "", isError: true, errorMessage: msg };
  } finally {
    unsub();
    cleanupAbort();
  }

  const raw = extractAssistantText(session.messages);
  const trunc = truncateHead(raw, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  let text = trunc.content;
  if (trunc.truncated) {
    text += `\n\n[Output truncated: ${trunc.outputLines} of ${trunc.totalLines} lines (${formatSize(trunc.outputBytes)} of ${formatSize(trunc.totalBytes)}).]`;
  }

  return { text, isError: false };
}
