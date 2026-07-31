import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  ASK_USER_PROMPT_EVENT,
  type AskUserPromptPayload,
  type CodingPlanRawUsage,
  type CodingPlanUsage,
  createLogger,
  isExtensionDisabled,
  MODAL_ACTIVE_EVENT,
  registerConfigItems,
  ZAI_CODING_PLAN_EVENTS,
} from "@htwang-contrib/common";
import {
  ActivityTracker,
  type AskUserQuestionSummary,
  lastAssistantTitleFromMessages,
  sessionKeyFor,
  summarizeAskUserQuestion,
} from "./activity.ts";
import { previewContent } from "./envelope.ts";
import { isMoshiHookAvailable, resolveTransportMode, sendEnvelope, snapshotCtx } from "./moshi-client.ts";
import { type MoshiCredentials, readMoshiSecrets } from "./moshi-secrets.ts";
import {
  lastAssistantMessage,
  loadSummaryConfig,
  resolveSummaryModel,
  SUMMARY_TITLE_FALLBACK,
  summarizeAgentTurn,
} from "./summarizer.ts";
import { buildZaiRawSnapshot, buildZaiSnapshot, pushUsageSnapshot } from "./usage-publisher.ts";

const IDLE_TITLE_FALLBACK = "Thinking next step...";
const USAGE_PUSH_MIN_INTERVAL_MS = 60_000;

const logger = createLogger("moshi-hooks-extra");

let cachedModels: Array<{ label: string; value: string }> = [];

export function setCachedModels(models: Array<{ label: string; value: string }>): void {
  cachedModels = models;
}

export default function moshiHooksExtra(pi: ExtensionAPI): void {
  if (isExtensionDisabled("moshi-hooks-extra")) return;
  logger.info("extension loaded");
  if (!isMoshiHookAvailable()) {
    return;
  }

  const transport = resolveTransportMode();
  if (transport === "none") return;

  registerConfigItems("moshi-hooks-extra", [
    {
      key: "enabled",
      type: "boolean",
      label: "Agent-end Summary",
      value: () => loadSummaryConfig().enabled,
      description:
        "Summarize each completed agent turn with an LLM before forwarding it to Moshi. When off, the user prompt is sent as-is.",
      extensionLabel: "Moshi Hooks Extra",
      order: 0,
    },
    {
      key: "model",
      type: "select",
      label: "Summary Model",
      value: () => loadSummaryConfig().model,
      description:
        "Model used to summarize completed agent turns before sending to Moshi. Leave as (default) to use the current session model.",
      extensionLabel: "Moshi Hooks Extra",
      order: 1,
      options: () => [{ label: "(session default)", value: "" }, ...cachedModels],
    },
  ]);

  const activity = new ActivityTracker();
  const pendingQuestion = new Map<string, AskUserQuestionSummary>();
  let cachedSessionId = "";
  let cachedCredentials: MoshiCredentials | null = null;
  let lastUsagePushAt = 0;
  let usagePushInFlight = false;
  let lastRawUsage: CodingPlanRawUsage | null = null;

  pi.on("session_start", (_event, ctx) => {
    cachedSessionId = sessionIdFromCtx(ctx);
    activity.reset();
    pendingQuestion.clear();
    cachedCredentials = readMoshiSecrets();
    const models = ctx.modelRegistry.getAvailable();
    cachedModels = models.map((m) => ({
      label: `${m.provider}/${m.id}`,
      value: `${m.provider}/${m.id}`,
    }));
  });

  pi.on("before_agent_start", (event, ctx) => {
    const cwd = ctx.cwd ?? "";
    const key = sessionKeyFor(sessionIdFromCtx(ctx), cwd);
    activity.rememberUserPrompt(key, event.prompt ?? "");
    return;
  });

  pi.on("tool_execution_start", (event, ctx) => {
    void sendEnvelope(
      {
        eventName: "ToolExecutionStart",
        event,
        ctx,
        extra: {
          tool_call_id: event.toolCallId,
          tool_name: prettyToolName(event.toolName),
          input: previewInput(event.args),
          contextPercent: contextPercentFromCtx(ctx),
        },
      },
      { preferSocket: true },
    );
    return;
  });

  pi.on("tool_execution_end", (event, ctx) => {
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
          contextPercent: contextPercentFromCtx(ctx),
        },
      },
      { preferSocket: true },
    );
    return;
  });

  pi.on("agent_end", (event, ctx) => {
    const cwd = ctx.cwd ?? "";
    const key = sessionKeyFor(sessionIdFromCtx(ctx), cwd);

    const userPrompt = activity.userPrompt(key);
    if (!userPrompt) return;

    const fallbackTitle = lastAssistantTitleFromMessages(event.messages) || IDLE_TITLE_FALLBACK;
    const config = loadSummaryConfig();
    const lastAssistant = lastAssistantMessage(event.messages);
    const contextPercent = contextPercentFromCtx(ctx);
    const ctxSnapshot = snapshotCtx(ctx);

    const sendEnd = (title: string, message: string): void => {
      void sendEnvelope(
        {
          eventName: "agent_end",
          event,
          ctx: ctxSnapshot,
          extra: {
            category: "task_complete",
            title,
            message,
            contextPercent,
          },
        },
        { preferSocket: true },
      );
    };

    if (!config.enabled || !lastAssistant) {
      sendEnd(fallbackTitle, userPrompt);
      return;
    }

    const summaryModel = resolveSummaryModel(ctx.modelRegistry, config) ?? ctx.model;

    void summarizeAgentTurn({
      userPrompt,
      lastAssistant,
      model: summaryModel,
      modelRegistry: ctx.modelRegistry,
      fallbackTitle,
      fallbackMessage: userPrompt,
    })
      .then((outcome) => {
        sendEnd(outcome.title || SUMMARY_TITLE_FALLBACK, outcome.message);
      })
      .catch(() => {
        sendEnd(fallbackTitle, userPrompt);
      });
    return;
  });

  pi.events.on(ASK_USER_PROMPT_EVENT, (data: unknown) => {
    const payload = data as AskUserPromptPayload;
    const summary = summarizeAskUserQuestion(payload);
    const cwd = process.cwd();
    pendingQuestion.set(sessionKeyFor(cachedSessionId, cwd), summary);
  });

  pi.events.on(ZAI_CODING_PLAN_EVENTS.RAW_USAGE_UPDATE, (data: unknown) => {
    const credentials = cachedCredentials ?? readMoshiSecrets();
    if (!credentials) return;
    const payload = data as { usage?: CodingPlanRawUsage } | undefined;
    const usage = payload?.usage;
    if (!usage?.windows.some((window) => window.kind === "tokens")) return;
    lastRawUsage = usage;
    const now = Date.now();
    if (usagePushInFlight || now - lastUsagePushAt < USAGE_PUSH_MIN_INTERVAL_MS) {
      return;
    }
    usagePushInFlight = true;
    lastUsagePushAt = now;
    const snapshot = buildZaiRawSnapshot(usage, credentials);
    void pushUsageSnapshot(snapshot, credentials, { logger }).finally(() => {
      usagePushInFlight = false;
    });
  });

  pi.events.on(ZAI_CODING_PLAN_EVENTS.USAGE_UPDATE, (data: unknown) => {
    // The raw event (fired alongside this one) carries the full window set
    // including tool-call windows; only fall back to the legacy payload when
    // it is the sole source.
    if (lastRawUsage) return;
    const credentials = cachedCredentials ?? readMoshiSecrets();
    if (!credentials) return;
    const payload = data as { usage?: CodingPlanUsage } | undefined;
    const usage = payload?.usage;
    if (!usage || usage.limits.length === 0) return;
    const now = Date.now();
    if (usagePushInFlight || now - lastUsagePushAt < USAGE_PUSH_MIN_INTERVAL_MS) {
      return;
    }
    usagePushInFlight = true;
    lastUsagePushAt = now;
    const snapshot = buildZaiSnapshot(usage, credentials);
    void pushUsageSnapshot(snapshot, credentials, { logger }).finally(() => {
      usagePushInFlight = false;
    });
  });

  pi.events.on(MODAL_ACTIVE_EVENT, (active: unknown) => {
    const cwd = process.cwd();
    const key = sessionKeyFor(cachedSessionId, cwd);
    const event = { active, session_id: cachedSessionId };
    if (active === true) {
      const summary = pendingQuestion.get(key) ?? summarizeAskUserQuestion(null);
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
    void sendEnvelope(
      {
        eventName: "question_replied",
        event,
        ctx: { cwd },
        extra: {
          phase: "running",
          category: "task_in_progress",
          title: IDLE_TITLE_FALLBACK,
        },
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

function contextPercentFromCtx(ctx: {
  getContextUsage?: () => { percent?: number | null } | undefined | null;
}): number | undefined {
  const pct = ctx.getContextUsage?.()?.percent;
  if (typeof pct !== "number" || !Number.isFinite(pct)) return undefined;
  return Math.max(0, Math.min(100, Math.round(pct)));
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
