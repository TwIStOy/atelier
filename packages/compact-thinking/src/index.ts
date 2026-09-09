import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Markdown, MouseRegion, Spacer, Text, type TUI } from "@earendil-works/pi-tui";
import { createLogger, isExtensionDisabled, isStaleCtxError, resolveModel } from "@htwang-contrib/common";
import { loadConfig, registerCompactThinkingConfigItems, setCachedModelOptions } from "./config.ts";
import { DURATION_ENTRY_TYPE, restoreDurationEntries } from "./durations.ts";
import { Gutter } from "./gutter.ts";
import { formatThoughtDuration, StrictThinkingPreview, SUMMARY_DISPLAY_PREFIX } from "./preview.ts";
import {
  extractThinkingRun,
  getRunSummary,
  restoreSummaryEntries,
  SUMMARY_ENTRY_TYPE,
  storeRunSummary,
} from "./summaries.ts";
import { summarizeThinking } from "./summary.ts";
import type { ActiveThinking, AssistantInternals, PatchedPrototype } from "./types.ts";
import { createWaveBar } from "./wave.ts";

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
  const originalSetHideThinkingBlock = prototype.setHideThinkingBlock;

  const completedDurations = new Map<number, Map<number, number>>();
  const completedSummaries = new Map<number, Map<number, string>>();
  const pendingSummaries = new Map<number, Set<number>>();
  const renderedComponents = new Set<AssistantMessageComponent>();
  const streamingComponents = new Set<AssistantMessageComponent>();
  const summarizingComponents = new Set<AssistantMessageComponent>();
  let expandedRuns = new WeakMap<AssistantMessageComponent, Set<number>>();
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
  let tuiSession = false;

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

  function thinkingBar(active: boolean) {
    if (!activeTheme) return THINKING_BAR;
    if (active) {
      const wave = createWaveBar(activeTheme, () => animationFrame, config.animationIntervalMs);
      if (wave) return wave;
    }
    return activeTheme.fg("borderMuted", THINKING_BAR);
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

  function isRunSummarizing(messageTimestamp: number, startIndex: number, endIndex: number) {
    const pending = pendingSummaries.get(messageTimestamp);
    if (!pending) return false;
    for (let index = endIndex; index >= startIndex; index--) {
      if (pending.has(index)) return true;
    }
    return false;
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
        const markdown = child as unknown as { defaultTextStyle?: unknown; paddingX?: number };
        if (child instanceof Markdown && markdown.defaultTextStyle) {
          markdown.paddingX = self.outputPad + THINKING_INDENT;
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

    let thinkingRunIndex = 0;

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
      const runIndex = thinkingRunIndex++;

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
        if (isRunSummarizing(message.timestamp, runStartIndex, runEndIndex)) {
          heading += thinkingStyle(" [ ") + animatedText("Summarizing...", thinkingStyle, true) + thinkingStyle(" ]");
        }
      }
      const previewSource = thinkingBlocks.join("\n\n");
      const summary = active
        ? undefined
        : getRunSummary(completedSummaries, message.timestamp, runStartIndex, runEndIndex);
      const expanded = expandedRuns.get(component)?.has(runIndex) ?? false;
      const block =
        expanded && previewSource.trim()
          ? new StrictThinkingPreview(
              heading,
              previewSource.trim(),
              self.outputPad + THINKING_INDENT,
              thinkingStyle,
              config.previewLines,
              true,
            )
          : summary !== undefined
            ? new StrictThinkingPreview(
                heading,
                `${SUMMARY_DISPLAY_PREFIX}${summary}`,
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
      const gutter = new Gutter(block, self.outputPad + THINKING_BAR_COLUMN, thinkingBar(active));
      self.contentContainer.addChild(
        new MouseRegion(gutter, (event) => {
          if (event.type !== "click" || event.button !== "left") return undefined;
          const runs = expandedRuns.get(component) ?? new Set<number>();
          if (runs.has(runIndex)) runs.delete(runIndex);
          else runs.add(runIndex);
          expandedRuns.set(component, runs);
          if (self.lastMessage) self.updateContent(self.lastMessage);
          return { handled: true };
        }),
      );

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

  function patchedSetHideThinkingBlock(this: AssistantMessageComponent, hide: boolean) {
    expandedRuns = new WeakMap();
    originalSetHideThinkingBlock.call(this, hide);
  }

  function startThinking(message: AssistantMessage, contentIndex: number) {
    activeThinking = {
      messageTimestamp: message.timestamp,
      contentIndex,
      startedAt: Date.now(),
    };
    streamingComponents.clear();
    animationFrame = 0;

    if (!tuiSession) return;

    if (latestComponent && latestComponentTimestamp === message.timestamp) {
      streamingComponents.add(latestComponent);
      const self = latestComponent as unknown as AssistantInternals;
      self.updateContent(message);
      activeTui?.requestRender();
    }

    ensureAnimationTimer();
  }

  function tickAnimation() {
    animationFrame++;
    // The gutter wave reads animationFrame at render time, so a plain re-render
    // animates it; full updateContent rebuilds (cold preview wrap caches) only
    // run every other tick to animate the heading/duration.
    if (animationFrame % 2 === 0) {
      for (const component of streamingComponents) {
        const self = component as unknown as AssistantInternals;
        if (self.lastMessage) self.updateContent(self.lastMessage);
      }
      for (const component of summarizingComponents) {
        if (streamingComponents.has(component)) continue;
        const self = component as unknown as AssistantInternals;
        if (self.lastMessage) self.updateContent(self.lastMessage);
      }
    }
    activeTui?.requestRender();
  }

  function ensureAnimationTimer() {
    if (!tuiSession || animationTimer) return;
    animationTimer = setInterval(tickAnimation, config.animationIntervalMs);
  }

  function maybeStopAnimationTimer() {
    if (activeThinking || pendingSummaries.size > 0) return;
    if (animationTimer) clearInterval(animationTimer);
    animationTimer = undefined;
  }

  function markRunSummarizing(messageTimestamp: number, contentIndex: number) {
    let pending = pendingSummaries.get(messageTimestamp);
    if (!pending) {
      pending = new Set();
      pendingSummaries.set(messageTimestamp, pending);
    }
    pending.add(contentIndex);
    for (const component of renderedComponents) {
      const self = component as unknown as AssistantInternals;
      if (self.lastMessage?.timestamp !== messageTimestamp) continue;
      summarizingComponents.add(component);
      self.updateContent(self.lastMessage);
    }
    ensureAnimationTimer();
    activeTui?.requestRender();
  }

  function unmarkRunSummarizing(messageTimestamp: number, contentIndex: number) {
    const pending = pendingSummaries.get(messageTimestamp);
    if (pending) {
      pending.delete(contentIndex);
      if (pending.size === 0) pendingSummaries.delete(messageTimestamp);
    }
    if (pendingSummaries.has(messageTimestamp)) return;
    for (const component of [...summarizingComponents]) {
      const self = component as unknown as AssistantInternals;
      if (self.lastMessage?.timestamp !== messageTimestamp) continue;
      summarizingComponents.delete(component);
      self.updateContent(self.lastMessage);
    }
    maybeStopAnimationTimer();
    activeTui?.requestRender();
  }

  function requestSummary(messageTimestamp: number, contentIndex: number, thinkingText: string) {
    const ctx = activeCtx;
    const summaryConfig = loadConfig();
    if (!ctx || !summaryConfig.summaryEnabled) return;
    if (thinkingText.length < summaryConfig.summaryMinChars) return;
    const resolved = summaryConfig.summaryModel
      ? resolveModel(ctx.modelRegistry.getAvailable(), summaryConfig.summaryModel)
      : undefined;
    const model = resolved ?? ctx.model;
    if (!model) return;
    const modelRegistry = ctx.modelRegistry;
    const signal = sessionAbort?.signal ?? new AbortController().signal;

    markRunSummarizing(messageTimestamp, contentIndex);
    void (async () => {
      try {
        const summary = await summarizeThinking({ thinkingText, model, modelRegistry, signal });
        if (!summary || signal.aborted) return;
        storeRunSummary(completedSummaries, messageTimestamp, contentIndex, summary);
        pi.appendEntry(SUMMARY_ENTRY_TYPE, { messageTimestamp, contentIndex, summary });
      } catch (err) {
        if (!isStaleCtxError(err)) {
          logger.debug(`summary request failed: ${String(err).slice(0, 300)}`);
        }
      } finally {
        unmarkRunSummarizing(messageTimestamp, contentIndex);
        refreshRenderedComponents();
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
    maybeStopAnimationTimer();

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
    tuiSession = true;
    prototype.updateContent = patchedUpdateContent;
    prototype.setHideThinkingBlock = patchedSetHideThinkingBlock;
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
    tuiSession = false;
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
    pendingSummaries.clear();
    renderedComponents.clear();
    streamingComponents.clear();
    summarizingComponents.clear();
    if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_ID, undefined);

    if (patchInstalled) {
      prototype.updateContent = originalUpdateContent;
      prototype.setHideThinkingBlock = originalSetHideThinkingBlock;
      patchInstalled = false;
    }
  });

  registerCompactThinkingConfigItems();
}
