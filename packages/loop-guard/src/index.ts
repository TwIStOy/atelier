import type { ThinkingContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled, isStaleCtxError } from "@htwang-contrib/common";
import { CONFIG_ID, loadConfig, registerConfig, thinkingLoopOptions, toolLoopOptions } from "./config.ts";
import { type ThinkingLoopDetection, ThinkingLoopDetector } from "./thinking-loop.ts";
import { type ToolLoopDetection, ToolLoopDetector } from "./tool-loop.ts";

function buildBlockReason(detection: ToolLoopDetection): string {
  if (detection.kind === "repeat") {
    return [
      `[loop-guard] Loop detected: ${detection.summary} — attempt #${detection.count} with identical arguments; all previous attempts returned identical results.`,
      "Repeating this call will not produce new information. Do not retry it.",
      "Change your approach: use different arguments, use a different tool, or stop and explain to the user why you are stuck.",
      "If this repetition is intentional (e.g. polling for a status change), tell the user what you are waiting for instead of retrying silently.",
    ].join(" ");
  }
  return [
    `[loop-guard] Loop detected: you are alternating between \`${detection.tools[0]}\` and \`${detection.tools[1]}\` in a fixed cycle (${detection.cycles} repetitions) and every iteration returns identical results.`,
    "This cycle is not making progress. Break out of it: reconsider the underlying problem, try a fundamentally different approach, or explain the deadlock to the user and ask for guidance.",
  ].join(" ");
}

function describeThinkingDetection(detection: ThinkingLoopDetection): string {
  if (detection.kind === "within-message") {
    return "thinking loop: the current response repeats the same reasoning paragraph verbatim — the model may be stuck in circular reasoning";
  }
  return `thinking loop: ${detection.repeatedChunks} reasoning paragraph(s) are verbatim repeats of earlier turns — the model is re-deriving the same thoughts without progress`;
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

  pi.on("session_start", () => {
    toolDetector.reset();
    thinkingDetector.reset();
    lastThinkingNotice = null;
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

  pi.on("message_end", (event, ctx) => {
    const config = loadConfig();
    if (!config.enabled || !config.thinkingEnabled) return;
    if (event.message.role !== "assistant") return;
    const content = event.message.content;
    if (!Array.isArray(content)) return;
    const thinkingTexts = content
      .filter((block): block is ThinkingContent => block.type === "thinking")
      .map((block) => block.thinking);
    const detection = thinkingDetector.checkMessage(thinkingTexts, thinkingLoopOptions(config));
    if (!detection) {
      lastThinkingNotice = null;
      return;
    }
    if (!config.notifyOnDetect || lastThinkingNotice === detection.kind) return;
    lastThinkingNotice = detection.kind;
    notifySafely(ctx, `loop-guard: ${describeThinkingDetection(detection)}`);
  });
}
