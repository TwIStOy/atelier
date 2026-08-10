import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Spacer, Text, type TUI } from "@earendil-works/pi-tui";
import { createLogger, isExtensionDisabled, isStaleCtxError, resolveModel } from "@htwang-contrib/common";
import { loadConfig, registerCompactThinkingConfigItems, setCachedModelOptions } from "./config.ts";
import { DURATION_ENTRY_TYPE, restoreDurationEntries } from "./durations.ts";
import { Gutter } from "./gutter.ts";
import { formatThoughtDuration, StrictThinkingPreview } from "./preview.ts";
import {
  extractThinkingRun,
  getRunSummary,
  restoreSummaryEntries,
  SUMMARY_ENTRY_TYPE,
  storeRunSummary,
} from "./summaries.ts";
import { summarizeThinking } from "./summary.ts";
import type { ActiveThinking, AssistantInternals, PatchedPrototype } from "./types.ts";

const logger = createLogger("compact-thinking");

const WIDGET_ID = "compact-thinking-render-loop";

const THINKING_INDENT = 3;
const THINKING_BAR_COLUMN = 1;
const THINKING_BAR = "▌";

export default function compactThinking(pi: ExtensionAPI) {
  if (isExtensionDisabled("compact-thinking")) return;

  const config = loadConfig();

  const prototype = AssistantMessageComponent.prototype as PatchedPrototype;
  const originalUpdateContent = prototype.updateContent;

  const completedDurations = new Map<number, Map<number, number>>();
  const completedSummaries = new Map<number, Map<number, string>>();
  const renderedComponents = new Set<AssistantMessageComponent>();
  const streamingComponents = new Set<AssistantMessageComponent>();
  let activeThinking: ActiveThinking | undefined;
  let activeTheme: Theme | undefined;
  let activeTui: TUI | undefined;
  let activeCtx: ExtensionContext | undefined;
  let sessionAbort: AbortController | undefined;
  let latestComponent: AssistantMessageComponent | undefined;
  let latestComponentTimestamp: number | undefined;
  let animationTimer: ReturnType<typeof setInterval> | undefined;
  let animationFrame = 0;
  let patchInstalled = false;

  function refreshRenderedComponents() {
    if (activeTui) {
      activeTui.invalidate();
      activeTui.requestRender(true);
      return;
    }

    for (const component of renderedComponents) {
      const self = component as unknown as AssistantInternals;
      if (self.lastMessage) self.updateContent(self.lastMessage);
    }
  }

  function thinkingStyle(text: string) {
    return activeTheme ? activeTheme.italic(activeTheme.fg("thinkingText", text)) : text;
  }

  function thinkingBar() {
    return activeTheme ? activeTheme.fg("borderMuted", THINKING_BAR) : THINKING_BAR;
  }

  function animatedText(text: string, baseStyle: (value: string) => string, animate: boolean) {
    if (!animate || !activeTheme) return baseStyle(text);

    const characters = Array.from(text);
    if (characters.length === 0) return "";
    const highlightWidth = Math.max(1, Math.min(5, Math.ceil(characters.length * 0.28)));
    const start = (animationFrame % (characters.length + highlightWidth)) - highlightWidth;
    const end = start + highlightWidth;
    const before = characters.slice(0, Math.max(0, start)).join("");
    const highlighted = characters.slice(Math.max(0, start), Math.min(characters.length, end)).join("");
    const after = characters.slice(Math.max(0, end)).join("");

    return (
      baseStyle(before) +
      (highlighted ? activeTheme.italic(activeTheme.bold(activeTheme.fg("text", highlighted))) : "") +
      baseStyle(after)
    );
  }

  function getCompletedDuration(messageTimestamp: number, startIndex: number, endIndex: number) {
    const durations = completedDurations.get(messageTimestamp);
    if (!durations) return undefined;
    for (let index = endIndex; index >= startIndex; index--) {
      const duration = durations.get(index);
      if (duration !== undefined) return duration;
    }
    return undefined;
  }

  function isActiveRun(message: AssistantMessage, startIndex: number, endIndex: number) {
    return (
      activeThinking?.messageTimestamp === message.timestamp &&
      activeThinking.contentIndex >= startIndex &&
      activeThinking.contentIndex <= endIndex
    );
  }

  function patchedUpdateContent(this: AssistantMessageComponent, message: AssistantMessage) {
    const component = this as AssistantMessageComponent;
    const self = this as unknown as AssistantInternals;
    self.lastMessage = message;
    renderedComponents.add(component);
    latestComponent = component;
    latestComponentTimestamp = message.timestamp;

    if (!self.hideThinkingBlock) {
      originalUpdateContent.call(this, message);
      for (const child of self.contentContainer.children) {
        if (child instanceof Markdown && (child as unknown as { defaultTextStyle?: unknown }).defaultTextStyle) {
          child.paddingX = self.outputPad + THINKING_INDENT;
        }
      }
      return;
    }

    if (activeThinking?.messageTimestamp === message.timestamp) {
      streamingComponents.add(component);
    }

    self.contentContainer.clear();
    const hasActiveThinking =
      activeThinking?.messageTimestamp === message.timestamp &&
      message.content.some((content) => content.type === "thinking");
    const hasVisibleContent =
      hasActiveThinking ||
      message.content.some(
        (content) =>
          (content.type === "text" && content.text.trim()) || (content.type === "thinking" && content.thinking.trim()),
      );
    if (hasVisibleContent) self.contentContainer.addChild(new Spacer(1));

    for (let i = 0; i < message.content.length; i++) {
      const content = message.content[i];

      if (content.type === "text" && content.text.trim()) {
        self.contentContainer.addChild(new Markdown(content.text.trim(), self.outputPad, 0, self.markdownTheme));
        continue;
      }

      if (content.type !== "thinking") continue;

      const runStartIndex = i;
      const hasVisibleContentBefore = message.content
        .slice(0, runStartIndex)
        .some(
          (previous) =>
            (previous.type === "text" && previous.text.trim()) ||
            (previous.type === "thinking" && previous.thinking.trim()),
        );
      const thinkingBlocks: string[] = [];
      for (; i < message.content.length; i++) {
        const thinkingContent = message.content[i];
        if (thinkingContent.type !== "thinking") break;
        const thinking = thinkingContent.thinking.trim();
        if (!thinking) continue;
        thinkingBlocks.push(thinking);
      }
      const runEndIndex = i - 1;
      i--;
      const active = isActiveRun(message, runStartIndex, runEndIndex);
      if (thinkingBlocks.length === 0 && !active) continue;
      if (hasVisibleContentBefore) {
        self.contentContainer.addChild(new Spacer(1));
      }

      const elapsedMs = activeThinking ? Math.max(1, Date.now() - activeThinking.startedAt) : undefined;
      const completedMs = getCompletedDuration(message.timestamp, runStartIndex, runEndIndex);
      const durationMs = active ? elapsedMs : completedMs;
      const durationText = durationMs === undefined ? undefined : formatThoughtDuration(durationMs);

      let heading: string;
      if (active) {
        const label = self.hiddenThinkingLabel || "Thinking...";
        heading = animatedText(label, thinkingStyle, true) + (durationText ? thinkingStyle(` · ${durationText}`) : "");
      } else {
        heading = thinkingStyle(
          durationText ? `Thought for ${durationText}` : self.hiddenThinkingLabel || "Thinking...",
        );
      }
      const previewSource = thinkingBlocks.join("\n\n");
      const summary = active
        ? undefined
        : getRunSummary(completedSummaries, message.timestamp, runStartIndex, runEndIndex);
      const block =
        summary !== undefined
          ? new StrictThinkingPreview(
              heading,
              summary,
              self.outputPad + THINKING_INDENT,
              thinkingStyle,
              Math.max(config.previewLines, 1),
            )
          : config.previewLines > 0 && previewSource.trim()
            ? new StrictThinkingPreview(
                heading,
                previewSource.trim(),
                self.outputPad + THINKING_INDENT,
                thinkingStyle,
                config.previewLines,
              )
            : new Text(heading, self.outputPad + THINKING_INDENT, 0);
      self.contentContainer.addChild(new Gutter(block, self.outputPad + THINKING_BAR_COLUMN, thinkingBar()));

      const hasVisibleContentAfter = message.content
        .slice(i + 1)
        .some(
          (next) => (next.type === "text" && next.text.trim()) || (next.type === "thinking" && next.thinking.trim()),
        );
      if (hasVisibleContentAfter) self.contentContainer.addChild(new Spacer(1));
    }

    const hasToolCalls = message.content.some((content) => content.type === "toolCall");
    self.hasToolCalls = hasToolCalls;

    if (message.stopReason === "length") {
      self.contentContainer.addChild(new Spacer(1));
      self.contentContainer.addChild(
        new Text(
          activeTheme
            ? activeTheme.fg(
                "error",
                "Error: Model stopped because it reached the maximum output token limit. The response may be incomplete.",
              )
            : "Error: Model stopped because it reached the maximum output token limit. The response may be incomplete.",
          self.outputPad,
          0,
        ),
      );
    } else if (!hasToolCalls) {
      if (message.stopReason === "aborted") {
        const abortMessage =
          message.errorMessage && message.errorMessage !== "Request was aborted"
            ? message.errorMessage
            : "Operation aborted";
        self.contentContainer.addChild(new Spacer(1));
        self.contentContainer.addChild(
          new Text(activeTheme ? activeTheme.fg("error", abortMessage) : abortMessage, self.outputPad, 0),
        );
      } else if (message.stopReason === "error") {
        const errorMessage = message.errorMessage || "Unknown error";
        self.contentContainer.addChild(new Spacer(1));
        self.contentContainer.addChild(
          new Text(
            activeTheme ? activeTheme.fg("error", `Error: ${errorMessage}`) : `Error: ${errorMessage}`,
            self.outputPad,
            0,
          ),
        );
      }
    }
  }

  function startThinking(message: AssistantMessage, contentIndex: number) {
    activeThinking = {
      messageTimestamp: message.timestamp,
      contentIndex,
      startedAt: Date.now(),
    };
    streamingComponents.clear();
    animationFrame = 0;

    if (latestComponent && latestComponentTimestamp === message.timestamp) {
      streamingComponents.add(latestComponent);
      const self = latestComponent as unknown as AssistantInternals;
      self.updateContent(message);
      activeTui?.requestRender();
    }

    if (animationTimer) clearInterval(animationTimer);
    animationTimer = setInterval(() => {
      animationFrame++;
      for (const component of streamingComponents) {
        const self = component as unknown as AssistantInternals;
        if (self.lastMessage) self.updateContent(self.lastMessage);
      }
      activeTui?.requestRender();
    }, config.animationIntervalMs);
  }

  function requestSummary(messageTimestamp: number, contentIndex: number, thinkingText: string) {
    const ctx = activeCtx;
    const summaryConfig = loadConfig();
    if (!ctx || !summaryConfig.summaryEnabled) return;
    const resolved = summaryConfig.summaryModel
      ? resolveModel(ctx.modelRegistry.getAvailable(), summaryConfig.summaryModel)
      : undefined;
    const model = resolved ?? ctx.model;
    if (!model) return;
    const modelRegistry = ctx.modelRegistry;
    const signal = sessionAbort?.signal ?? new AbortController().signal;

    void (async () => {
      try {
        const summary = await summarizeThinking({ thinkingText, model, modelRegistry, signal });
        if (!summary || signal.aborted) return;
        storeRunSummary(completedSummaries, messageTimestamp, contentIndex, summary);
        pi.appendEntry(SUMMARY_ENTRY_TYPE, { messageTimestamp, contentIndex, summary });
        refreshRenderedComponents();
      } catch (err) {
        if (isStaleCtxError(err)) return;
        logger.debug(`summary request failed: ${String(err).slice(0, 300)}`);
      }
    })();
  }

  function finishThinking(options?: { summarize?: boolean }) {
    if (!activeThinking) return;
    const finished = activeThinking;
    const durationMs = Math.max(1, Date.now() - finished.startedAt);
    let durations = completedDurations.get(finished.messageTimestamp);
    if (!durations) {
      durations = new Map();
      completedDurations.set(finished.messageTimestamp, durations);
    }
    durations.set(finished.contentIndex, durationMs);
    pi.appendEntry(DURATION_ENTRY_TYPE, {
      messageTimestamp: finished.messageTimestamp,
      contentIndex: finished.contentIndex,
      durationMs,
    });

    if (options?.summarize) {
      let message: AssistantMessage | undefined;
      for (const component of streamingComponents) {
        const lastMessage = (component as unknown as AssistantInternals).lastMessage;
        if (lastMessage?.timestamp === finished.messageTimestamp) {
          message = lastMessage;
          break;
        }
      }
      if (!message && latestComponentTimestamp === finished.messageTimestamp) {
        message = (latestComponent as unknown as AssistantInternals | undefined)?.lastMessage;
      }
      if (message) {
        const thinkingText = extractThinkingRun(message, finished.contentIndex);
        if (thinkingText) requestSummary(finished.messageTimestamp, finished.contentIndex, thinkingText);
      }
    }

    activeThinking = undefined;
    if (animationTimer) clearInterval(animationTimer);
    animationTimer = undefined;

    const components = [...streamingComponents];
    streamingComponents.clear();
    for (const component of components) {
      const self = component as unknown as AssistantInternals;
      if (self.lastMessage) self.updateContent(self.lastMessage);
    }
    activeTui?.requestRender();
  }

  pi.on("message_update", (event) => {
    if (event.message.role !== "assistant") return;
    const update = event.assistantMessageEvent;

    if (update.type === "thinking_start") {
      if (activeThinking?.messageTimestamp === event.message.timestamp) {
        activeThinking.contentIndex = update.contentIndex;
      } else {
        if (activeThinking) finishThinking({ summarize: true });
        startThinking(event.message, update.contentIndex);
      }
    } else if (update.type === "thinking_delta") {
      if (!activeThinking) {
        startThinking(event.message, update.contentIndex);
      } else if (activeThinking.messageTimestamp === event.message.timestamp) {
        activeThinking.contentIndex = update.contentIndex;
      }
    } else if (update.type === "text_start" || update.type === "toolcall_start" || update.type === "toolcall_delta") {
      finishThinking({ summarize: true });
    }
  });

  pi.on("tool_execution_start", () => finishThinking({ summarize: true }));
  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") finishThinking({ summarize: true });
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    prototype.updateContent = patchedUpdateContent;
    patchInstalled = true;
    restoreDurationEntries(ctx.sessionManager.getBranch(), completedDurations);
    restoreSummaryEntries(ctx.sessionManager.getBranch(), completedSummaries);
    activeTheme = ctx.ui.theme;
    activeCtx = ctx;
    sessionAbort = new AbortController();
    setCachedModelOptions(
      ctx.modelRegistry.getAvailable().map((m) => ({
        label: `${m.provider}/${m.id}`,
        value: `${m.provider}/${m.id}`,
      })),
    );

    ctx.ui.setWidget(WIDGET_ID, (tui) => {
      activeTui = tui;
      return { render: () => [], invalidate() {} };
    });

    refreshRenderedComponents();
  });

  pi.on("session_tree", (_event, ctx) => {
    restoreDurationEntries(ctx.sessionManager.getBranch(), completedDurations);
    restoreSummaryEntries(ctx.sessionManager.getBranch(), completedSummaries);
    refreshRenderedComponents();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    finishThinking();
    if (animationTimer) clearInterval(animationTimer);
    animationTimer = undefined;
    sessionAbort?.abort();
    sessionAbort = undefined;
    activeCtx = undefined;
    activeTui = undefined;
    activeTheme = undefined;
    latestComponent = undefined;
    latestComponentTimestamp = undefined;
    completedDurations.clear();
    completedSummaries.clear();
    renderedComponents.clear();
    streamingComponents.clear();
    if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_ID, undefined);

    if (patchInstalled) {
      prototype.updateContent = originalUpdateContent;
      patchInstalled = false;
    }
  });

  registerCompactThinkingConfigItems();
}
