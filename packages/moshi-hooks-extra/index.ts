import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  ASK_USER_PROMPT_EVENT,
  MODAL_ACTIVE_EVENT,
  type AskUserPromptPayload,
} from "@htwang-contrib/common";
import {
  isMoshiHookAvailable,
  resolveTransportMode,
  sendEnvelope,
} from "./moshi-client.ts";
import { previewContent } from "./envelope.ts";
import {
  ActivityTracker,
  assistantTitleFromMessage,
  sessionKeyFor,
  summarizeAskUserQuestion,
  type AskUserQuestionSummary,
} from "./activity.ts";

const IDLE_TITLE_FALLBACK = "Thinking next step...";

export default function moshiHooksExtra(pi: ExtensionAPI): void {
  if (!isMoshiHookAvailable()) {
    return;
  }

  const transport = resolveTransportMode();
  if (transport === "none") return;

  const activity = new ActivityTracker();
  const pendingQuestion = new Map<string, AskUserQuestionSummary>();
  let cachedSessionId = "";

  pi.on("session_start", (_event, ctx) => {
    cachedSessionId = sessionIdFromCtx(ctx);
    activity.reset();
    pendingQuestion.clear();
  });

  pi.on("before_agent_start", (event, ctx) => {
    const cwd = ctx.cwd ?? "";
    const key = sessionKeyFor(sessionIdFromCtx(ctx), cwd);
    activity.rememberUserPrompt(key, event.prompt ?? "");
    activity.markActive(key);
    return;
  });

  pi.on("tool_execution_start", (event, ctx) => {
    const key = sessionKeyFor(sessionIdFromCtx(ctx), ctx.cwd ?? "");
    activity.markActive(key);
    void sendEnvelope(
      {
        eventName: "ToolExecutionStart",
        event,
        ctx,
        extra: {
          tool_call_id: event.toolCallId,
          tool_name: prettyToolName(event.toolName),
          input: previewInput(event.args),
        },
      },
      { preferSocket: true },
    );
    return;
  });

  pi.on("tool_execution_end", (event, ctx) => {
    const key = sessionKeyFor(sessionIdFromCtx(ctx), ctx.cwd ?? "");
    activity.markActive(key);
    void sendEnvelope(
      {
        eventName: "ToolExecutionEnd",
        event,
        ctx,
        extra: {
          tool_call_id: event.toolCallId,
          tool_name: prettyToolName(event.toolName),
          is_error: event.isError,
          result_preview: previewContent(event.result),
        },
      },
      { preferSocket: true },
    );
    return;
  });

  pi.on("turn_end", (event, ctx) => {
    const cwd = ctx.cwd ?? "";
    const sessionID = sessionIdFromCtx(ctx);
    const key = sessionKeyFor(sessionID, cwd);

    const title = assistantTitleFromMessage(event.message);
    if (title) activity.rememberAssistantTitle(key, title);

    const idle = activity.shouldEmitIdle(key);
    if (!idle.emit) return;

    activity.markIdlePublished(key);
    void sendEnvelope(
      {
        eventName: "turn_end",
        event,
        ctx,
        extra: {
          category: "task_complete",
          title: idle.title || IDLE_TITLE_FALLBACK,
          message: idle.prompt,
        },
      },
      { preferSocket: true },
    );
    return;
  });

  pi.events.on(ASK_USER_PROMPT_EVENT, (data: unknown) => {
    const payload = data as AskUserPromptPayload;
    const summary = summarizeAskUserQuestion(payload);
    const cwd = process.cwd();
    pendingQuestion.set(sessionKeyFor(cachedSessionId, cwd), summary);
  });

  pi.events.on(MODAL_ACTIVE_EVENT, (active: unknown) => {
    const cwd = process.cwd();
    const key = sessionKeyFor(cachedSessionId, cwd);
    const event = { active, session_id: cachedSessionId };
    if (active === true) {
      const summary =
        pendingQuestion.get(key) ?? summarizeAskUserQuestion(null);
      void sendEnvelope(
        {
          eventName: "question_asked",
          event,
          ctx: { cwd },
          extra: {
            phase: "waitingForApproval",
            category: "approval_required",
            title: summary.title,
            subtitle: "Answer in terminal",
            message: summary.message,
          },
        },
        { preferSocket: true },
      );
      return;
    }
    pendingQuestion.delete(key);
    activity.markActive(key);
    void sendEnvelope(
      {
        eventName: "question_replied",
        event,
        ctx: { cwd },
        extra: {},
      },
      { preferSocket: true },
    );
    return;
  });
}

function sessionIdFromCtx(ctx: { sessionManager?: unknown }): string {
  const sessionManager = ctx.sessionManager as
    | (Record<string, unknown> & {
        getSessionFile?: (...args: unknown[]) => unknown;
      })
    | undefined;
  const getSessionFile = sessionManager?.getSessionFile;
  if (typeof getSessionFile !== "function") return "";
  try {
    return String(getSessionFile.call(sessionManager) ?? "");
  } catch {
    return "";
  }
}

function previewInput(args: unknown, maxChars = 2000): string {
  if (args === null || args === undefined) return "";
  if (typeof args === "string") return previewContent(args, maxChars);
  try {
    return previewContent(JSON.stringify(args), maxChars);
  } catch {
    return "";
  }
}

function prettyToolName(toolName: string): string {
  switch (toolName) {
    case "bash":
      return "Bash";
    case "edit":
      return "Edit";
    case "write":
      return "Write";
    case "read":
      return "Read";
    case "grep":
      return "Grep";
    case "find":
    case "glob":
      return "Find";
    case "ls":
      return "Ls";
    case "web_fetch":
      return "WebFetch";
    case "web_search":
      return "WebSearch";
    case "task":
      return "Task";
    default:
      return toolName;
  }
}

export { prettyToolName, previewInput, sessionIdFromCtx };
