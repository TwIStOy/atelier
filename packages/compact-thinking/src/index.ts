import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { Markdown, MouseRegion, Spacer, Text, type TUI } from "@earendil-works/pi-tui";
import {
  clearRailTailSpacing,
  componentRendersLines,
  createLogger,
  findComponentContext,
  isExtensionDisabled,
  isStaleCtxError,
  isThoughtMember,
  isThoughtMemberClaimed,
  RAIL_BULLET_SINGLE,
  type RailBar,
  type RailSpec,
  readRailTailSpacing,
  resolveModel,
  setRailTailSpacing,
  setThoughtMember,
  setThoughtMemberClaimed,
  setThoughtTransparent,
  TOOL_RAIL_LAYOUT,
  ToolRailComponent,
} from "@htwang-contrib/common";
import { loadConfig, registerCompactThinkingConfigItems, setCachedModelOptions } from "./config.ts";
import { DURATION_ENTRY_TYPE, restoreDurationEntries } from "./durations.ts";
import { ActiveThinkingPreview, formatThoughtDuration, SingleLineText, StrictThinkingPreview } from "./preview.ts";
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

const THINKING_BAR = "┃";

const PASSTHROUGH_THEME: Theme = { fg: (_color: string, text: string) => text } as Theme;

type RenderedItem = { kind: "text"; text: string } | { kind: "thinking"; startIndex: number; endIndex: number };

function collectRenderedItems(message: AssistantMessage, active: ActiveThinking | undefined): RenderedItem[] {
  const items: RenderedItem[] = [];
  let i = 0;
  while (i < message.content.length) {
    const content = message.content[i];
    if (content.type === "text" && content.text.trim()) {
      items.push({ kind: "text", text: content.text.trim() });
      i++;
      continue;
    }
    if (content.type !== "thinking") {
      i++;
      continue;
    }
    const startIndex = i;
    while (i < message.content.length && message.content[i].type === "thinking") i++;
    const endIndex = i - 1;
    const hasBlocks = message.content
      .slice(startIndex, endIndex + 1)
      .some((block) => block.type === "thinking" && block.thinking.trim());
    const isActive =
      active?.messageTimestamp === message.timestamp &&
      active.contentIndex >= startIndex &&
      active.contentIndex <= endIndex;
    if (hasBlocks || isActive) items.push({ kind: "thinking", startIndex, endIndex });
  }
  return items;
}

function currentBlockSpacing(): number {
  const value = loadConfig().blockSpacing;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5, Math.floor(value)));
}

export default function compactThinking(pi: ExtensionAPI) {
  if (isExtensionDisabled("compact-thinking")) return;

  const config = loadConfig();

  const prototype = AssistantMessageComponent.prototype as PatchedPrototype;
  const originalUpdateContent = prototype.updateContent;
  const originalSetHideThinkingBlock = prototype.setHideThinkingBlock;
  const originalRender = prototype.render;

  const completedDurations = new Map<number, Map<number, number>>();
  const completedSummaries = new Map<number, Map<number, string>>();
  const pendingSummaries = new Map<number, Set<number>>();
  const renderedComponents = new Set<AssistantMessageComponent>();
  const streamingComponents = new Set<AssistantMessageComponent>();
  const summarizingComponents = new Set<AssistantMessageComponent>();
  const leadingBlankDropped = new WeakSet<AssistantMessageComponent>();
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

  function activeRailBar(): RailBar | undefined {
    if (!activeTheme) return undefined;
    return (
      createWaveBar(activeTheme, () => animationFrame, config.animationIntervalMs) ??
      activeTheme.fg("borderMuted", THINKING_BAR)
    );
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

  // The dropped leading blank is only correct when the closest previous visible
  // sibling renders into the rail column (a tool execution or a rail-tail marked
  // assistant message). Against anything else (user message, notices, plain
  // assistant text) the stock component always kept one blank line above.
  // Tool executions are classified by identity so this walk never calls their
  // render — those patches scan siblings during render and would ping-pong.
  // Decided at render time: updateContent also runs while a message component is
  // not yet attached to the chat container, so the sibling above is only known
  // once rendering actually happens.
  function needsSeparatorAbove(component: AssistantMessageComponent, width: number): boolean {
    const context = activeTui ? findComponentContext(activeTui, component) : undefined;
    if (!context) return false;
    for (let i = context.index - 1; i >= 0; i--) {
      const sibling = context.siblings[i];
      if (sibling instanceof ToolExecutionComponent) {
        if ((sibling as unknown as { hideComponent?: boolean }).hideComponent) continue;
        return false;
      }
      if (!componentRendersLines(sibling, width)) continue;
      return readRailTailSpacing(sibling) === undefined;
    }
    return false;
  }

  function patchedRender(this: AssistantMessageComponent, width: number): string[] {
    if (isThoughtMember(this) && isThoughtMemberClaimed(this)) return [];
    const lines = originalRender.call(this, width);
    if (lines.length === 0 || !leadingBlankDropped.has(this)) return lines;
    return needsSeparatorAbove(this, width) ? ["", ...lines] : lines;
  }

  function patchedUpdateContent(this: AssistantMessageComponent, message: AssistantMessage) {
    const component = this as AssistantMessageComponent;
    const self = this as unknown as AssistantInternals;
    self.lastMessage = message;
    renderedComponents.add(component);
    latestComponent = component;
    latestComponentTimestamp = message.timestamp;

    if (!self.hideThinkingBlock) {
      leadingBlankDropped.delete(component);
      clearRailTailSpacing(component);
      setThoughtMember(component, false);
      setThoughtMemberClaimed(component, false);
      setThoughtTransparent(component, false);
      originalUpdateContent.call(this, message);
      for (const child of self.contentContainer.children) {
        const markdown = child as unknown as { defaultTextStyle?: unknown; paddingX?: number };
        if (child instanceof Markdown && markdown.defaultTextStyle) {
          markdown.paddingX = TOOL_RAIL_LAYOUT.prefixWidth;
        }
      }
      return;
    }

    if (activeThinking?.messageTimestamp === message.timestamp) {
      streamingComponents.add(component);
    }

    self.contentContainer.clear();
    const spacing = currentBlockSpacing();
    const items = collectRenderedItems(message, activeThinking);

    // ThoughtMember eligibility: finished, collapsed, text-free. The component
    // keeps building its heading row; tool-display's verb-group claims eligible
    // members by stamping them, and only claimed members render zero lines (see
    // patchedRender). The claim is cleared here on every content rebuild so a
    // stale fold never survives a message change.
    const streaming = activeThinking?.messageTimestamp === message.timestamp;
    const hasExpandedRun = (expandedRuns.get(component)?.size ?? 0) > 0;
    const hasTextItem = items.some((item) => item.kind === "text");
    const hasNotice =
      message.stopReason === "length" || message.stopReason === "aborted" || message.stopReason === "error";
    const eligible = !streaming && !hasExpandedRun && !hasTextItem && !hasNotice && items.length > 0;
    setThoughtMember(component, eligible);
    setThoughtMemberClaimed(component, false);
    setThoughtTransparent(
      component,
      !eligible && (streaming || hasExpandedRun) && !hasTextItem && !hasNotice && items.length > 0,
    );

    const droppedLeadingBlank = items.length > 0 && items[0].kind === "thinking" && spacing === 0;
    if (droppedLeadingBlank) leadingBlankDropped.add(component);
    else leadingBlankDropped.delete(component);
    const addSpacer = (lines: number) => {
      if (lines > 0) self.contentContainer.addChild(new Spacer(lines));
    };

    if (items.length > 0) addSpacer(items[0].kind === "text" ? 1 : spacing);

    let thinkingRunIndex = 0;

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];

      if (item.kind === "text") {
        self.contentContainer.addChild(new Markdown(item.text, self.outputPad, 0, self.markdownTheme));
        continue;
      }

      if (items[itemIndex - 1]?.kind === "text") addSpacer(Math.max(spacing, 1));

      const runStartIndex = item.startIndex;
      const runEndIndex = item.endIndex;
      const thinkingBlocks: string[] = [];
      for (let j = runStartIndex; j <= runEndIndex; j++) {
        const block = message.content[j];
        if (block.type !== "thinking") continue;
        const thinking = block.thinking.trim();
        if (thinking) thinkingBlocks.push(thinking);
      }
      const active = isActiveRun(message, runStartIndex, runEndIndex);
      const runIndex = thinkingRunIndex++;

      const elapsedMs = activeThinking ? Math.max(1, Date.now() - activeThinking.startedAt) : undefined;
      const completedMs = getCompletedDuration(message.timestamp, runStartIndex, runEndIndex);
      const durationMs = active ? elapsedMs : completedMs;
      const durationText = durationMs === undefined ? undefined : formatThoughtDuration(durationMs);

      const previewSource = thinkingBlocks.join("\n\n");
      const summary = active
        ? undefined
        : getRunSummary(completedSummaries, message.timestamp, runStartIndex, runEndIndex);
      const expanded = expandedRuns.get(component)?.has(runIndex) ?? false;
      const useExpanded = expanded && previewSource.trim() !== "";

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
        } else if (summary !== undefined && !useExpanded) {
          heading += thinkingStyle(` — ${summary}`);
        }
      }

      const spec: RailSpec = {
        mark: useExpanded ? "run" : "none",
        bullet: RAIL_BULLET_SINGLE,
        status: active ? undefined : "dim",
      };
      if (active) spec.bar = activeRailBar();
      const previewText = previewSource.trim();
      const block = useExpanded
        ? new StrictThinkingPreview(heading, previewText, thinkingStyle)
        : active && config.previewLines > 0 && previewText
          ? new ActiveThinkingPreview(heading, previewText, config.previewLines, thinkingStyle)
          : new SingleLineText(heading);
      const rail = new ToolRailComponent(block, spec, activeTheme ?? PASSTHROUGH_THEME);
      self.contentContainer.addChild(
        new MouseRegion(rail, (event) => {
          if (event.type !== "click" || event.button !== "left") return undefined;
          const runs = expandedRuns.get(component) ?? new Set<number>();
          if (runs.has(runIndex)) runs.delete(runIndex);
          else runs.add(runIndex);
          expandedRuns.set(component, runs);
          if (self.lastMessage) self.updateContent(self.lastMessage);
          return { handled: true };
        }),
      );

      const nextKind = itemIndex + 1 < items.length ? items[itemIndex + 1].kind : undefined;
      addSpacer(nextKind === "text" ? Math.max(spacing, 1) : spacing);
    }

    const hasToolCalls = message.content.some((content) => content.type === "toolCall");
    self.hasToolCalls = hasToolCalls;

    let noticeAppended = false;
    if (message.stopReason === "length") {
      noticeAppended = true;
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
        noticeAppended = true;
        const abortMessage =
          message.errorMessage && message.errorMessage !== "Request was aborted"
            ? message.errorMessage
            : "Operation aborted";
        self.contentContainer.addChild(new Spacer(1));
        self.contentContainer.addChild(
          new Text(activeTheme ? activeTheme.fg("error", abortMessage) : abortMessage, self.outputPad, 0),
        );
      } else if (message.stopReason === "error") {
        noticeAppended = true;
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

    if (!noticeAppended && items[items.length - 1]?.kind === "thinking") {
      setRailTailSpacing(component, spacing);
    } else {
      clearRailTailSpacing(component);
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
    // The rail wave reads animationFrame at render time, so a plain re-render
    // animates it; full updateContent rebuilds (needed for the heading highlight
    // and duration) only run every other tick, and never for components with an
    // expanded run — rebuilding would re-wrap the expanded preview's full text.
    if (animationFrame % 2 === 0) {
      for (const component of streamingComponents) {
        if (expandedRuns.get(component)?.size) continue;
        const self = component as unknown as AssistantInternals;
        if (self.lastMessage) self.updateContent(self.lastMessage);
      }
      for (const component of summarizingComponents) {
        if (streamingComponents.has(component)) continue;
        if (expandedRuns.get(component)?.size) continue;
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
    prototype.render = patchedRender;
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
      prototype.render = originalRender;
      patchInstalled = false;
    }
  });

  registerCompactThinkingConfigItems();
}
