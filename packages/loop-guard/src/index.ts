import type { ThinkingContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, MessageEndEvent } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled, isStaleCtxError } from "@htwang-contrib/common";
import {
  CONFIG_ID,
  type LoopGuardConfig,
  loadConfig,
  registerConfig,
  thinkingLoopOptions,
  toolLoopOptions,
} from "./config.ts";
import { buildStreamRecovery, buildThinkingRecovery } from "./recovery.ts";
import { detectRepeatingSuffix } from "./stream-loop.ts";
import { type ThinkingLoopDetection, ThinkingLoopDetector } from "./thinking-loop.ts";
import { type ToolLoopDetection, ToolLoopDetector } from "./tool-loop.ts";

type StreamKind = "thinking" | "output";

interface PendingStreamLoop {
  stream: StreamKind;
  contentIndex: number;
  cleanPrefix: string;
  period: number;
}

type AssistantMessage = Extract<MessageEndEvent["message"], { role: "assistant" }>;

function buildBlockReason(detection: ToolLoopDetection): string {
  if (detection.kind === "repeat") {
    return [
      `[loop-guard] Loop detected: ${detection.summary} — attempt #${detection.count} with identical arguments; all previous attempts returned identical results.`,
      "This exact call did NOT run, and it will keep being blocked while arguments and results stay identical.",
      "Change your approach: use different arguments, use a different tool, or use what you already learned to move forward.",
      "If this repetition is intentional (e.g. polling for a status change), tell the user what you are waiting for instead of retrying silently.",
    ].join(" ");
  }
  return [
    `[loop-guard] Loop detected: you are alternating between \`${detection.tools[0]}\` and \`${detection.tools[1]}\` in a fixed cycle (${detection.cycles} repetitions) and every iteration returns identical results.`,
    "This exact call did NOT run. The cycle is not converging.",
    "Break out of it: reconsider the underlying problem, try a fundamentally different approach, or explain the deadlock to the user and ask for guidance.",
  ].join(" ");
}

function describeThinkingDetection(detection: ThinkingLoopDetection): string {
  if (detection.kind === "within-message") {
    return "thinking loop: the current response repeats the same reasoning paragraph verbatim — the model may be stuck in circular reasoning";
  }
  return `thinking loop: ${detection.repeatedChunks} reasoning paragraph(s) are verbatim repeats of earlier turns — the model is re-deriving the same thoughts without progress`;
}

function sanitizeStreamMessage(message: AssistantMessage, pending: PendingStreamLoop): AssistantMessage {
  if (!Array.isArray(message.content)) return message;
  const content = [...message.content];
  const block = content[pending.contentIndex];
  const label = `\n\n[loop-guard: repetitive ${pending.stream} truncated — loop detected]`;
  if (block?.type === "thinking") {
    content[pending.contentIndex] = { ...block, thinking: `${pending.cleanPrefix}${label}` };
  } else if (block?.type === "text") {
    content[pending.contentIndex] = { ...block, text: `${pending.cleanPrefix}${label}` };
  } else {
    return message;
  }
  return { ...message, content };
}

function notifySafely(ctx: ExtensionContext, message: string): void {
  try {
    ctx.ui.notify(message, "warning");
  } catch (err) {
    if (!isStaleCtxError(err)) throw err;
  }
}

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled(CONFIG_ID)) return;
  registerConfig();

  const toolDetector = new ToolLoopDetector();
  const thinkingDetector = new ThinkingLoopDetector();
  let lastThinkingNotice: string | null = null;
  let consecutiveThinkingDetections = 0;
  let streamConfig: LoopGuardConfig | null = null;
  let streamAborted = false;
  let streamCheckedLen = 0;
  let streamContentIndex: number | null = null;
  let pendingStreamLoop: PendingStreamLoop | null = null;

  pi.on("session_start", () => {
    toolDetector.reset();
    thinkingDetector.reset();
    lastThinkingNotice = null;
    consecutiveThinkingDetections = 0;
    streamConfig = null;
    streamAborted = false;
    streamCheckedLen = 0;
    streamContentIndex = null;
    pendingStreamLoop = null;
  });

  pi.on("turn_start", () => {
    streamConfig = loadConfig();
    streamAborted = false;
    streamCheckedLen = 0;
    streamContentIndex = null;
    pendingStreamLoop = null;
  });

  pi.on("tool_call", (event, ctx) => {
    const config = loadConfig();
    if (!config.enabled) return;
    const detection = toolDetector.checkCall(event.toolName, event.input, toolLoopOptions(config));
    if (!detection) return;
    if (config.notifyOnDetect) {
      const summary =
        detection.kind === "repeat"
          ? `blocked repeated ${detection.summary} (attempt #${detection.count})`
          : `blocked ping-pong cycle between ${detection.tools[0]} and ${detection.tools[1]} (${detection.cycles} cycles)`;
      notifySafely(ctx, `loop-guard: ${summary}`);
    }
    return { block: true, reason: buildBlockReason(detection) };
  });

  pi.on("tool_result", (event) => {
    const config = loadConfig();
    if (!config.enabled) return;
    const text = event.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    toolDetector.recordResult(event.toolName, event.input, text, event.isError, toolLoopOptions(config));
  });

  pi.on("message_update", (event, ctx) => {
    if (streamConfig === null) streamConfig = loadConfig();
    const config = streamConfig;
    if (!config.enabled || !config.streamDetectionEnabled || streamAborted) return;
    if (event.message.role !== "assistant") return;
    const ame = event.assistantMessageEvent;
    if (ame.type !== "thinking_delta" && ame.type !== "text_delta") return;
    if (!Array.isArray(event.message.content)) return;
    const block = event.message.content[ame.contentIndex];
    const text = block?.type === "thinking" ? block.thinking : block?.type === "text" ? block.text : null;
    if (text === null) return;
    if (ame.contentIndex !== streamContentIndex || text.length < streamCheckedLen) {
      streamContentIndex = ame.contentIndex;
      streamCheckedLen = 0;
    }
    if (text.length < streamCheckedLen + config.streamStride) return;
    streamCheckedLen = text.length;
    const repeat = detectRepeatingSuffix(text, {
      minWindow: config.streamMinWindow,
      maxWindow: config.streamMaxWindow,
    });
    if (!repeat) return;
    streamAborted = true;
    pendingStreamLoop = {
      stream: ame.type === "thinking_delta" ? "thinking" : "output",
      contentIndex: ame.contentIndex,
      cleanPrefix: repeat.cleanPrefix,
      period: repeat.period,
    };
    ctx.abort();
  });

  pi.on("message_end", (event, ctx) => {
    const config = loadConfig();
    if (!config.enabled) return;
    if (event.message.role !== "assistant") return;

    if (streamAborted) {
      streamAborted = false;
      const pending = pendingStreamLoop;
      pendingStreamLoop = null;
      if (!pending) return;
      consecutiveThinkingDetections++;
      const message = sanitizeStreamMessage(event.message, pending);
      const hasToolCalls = Array.isArray(message.content) && message.content.some((block) => block.type === "toolCall");
      if (
        config.thinkingInjectRecovery &&
        !hasToolCalls &&
        consecutiveThinkingDetections <= config.thinkingMaxInjections
      ) {
        pi.sendMessage(
          {
            customType: "loop-guard:recovery",
            content: buildStreamRecovery(pending.stream, consecutiveThinkingDetections),
            display: true,
          },
          { triggerTurn: true, deliverAs: "followUp" },
        );
      }
      if (config.notifyOnDetect) {
        lastThinkingNotice = `stream-${pending.stream}`;
        notifySafely(
          ctx,
          `loop-guard: ${pending.stream} stream was repeating verbatim — aborted and truncated the repetition`,
        );
      }
      return { message };
    }

    if (!config.thinkingEnabled) return;
    const content = event.message.content;
    if (!Array.isArray(content)) return;
    const thinkingTexts = content
      .filter((block): block is ThinkingContent => block.type === "thinking")
      .map((block) => block.thinking);
    const detection = thinkingDetector.checkMessage(thinkingTexts, thinkingLoopOptions(config));
    if (!detection) {
      lastThinkingNotice = null;
      consecutiveThinkingDetections = 0;
      return;
    }
    consecutiveThinkingDetections++;
    const hasToolCalls = content.some((block) => block.type === "toolCall");
    if (
      config.thinkingInjectRecovery &&
      !hasToolCalls &&
      consecutiveThinkingDetections <= config.thinkingMaxInjections
    ) {
      pi.sendMessage(
        {
          customType: "loop-guard:recovery",
          content: buildThinkingRecovery(detection, consecutiveThinkingDetections),
          display: true,
        },
        { triggerTurn: true, deliverAs: "followUp" },
      );
    }
    if (!config.notifyOnDetect || lastThinkingNotice === detection.kind) return;
    lastThinkingNotice = detection.kind;
    notifySafely(ctx, `loop-guard: ${describeThinkingDetection(detection)}`);
  });
}
