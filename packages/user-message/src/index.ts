import type { UserMessage } from "@earendil-works/pi-ai";
import {
  buildSessionContext,
  type ExtensionAPI,
  type ExtensionContext,
  getMarkdownTheme,
  parseSkillBlock,
  type Theme,
  type ThemeColor,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Markdown, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { AsyncAnnotations } from "@htwang-contrib/common/async-annotations";
import { type ClassifierCall, createClassifierCall } from "@htwang-contrib/common/classifier-models";
import { findComponentContext } from "@htwang-contrib/common/component-tree";
import { isExtensionDisabled } from "@htwang-contrib/common/extension-disable";
import { createLogger } from "@htwang-contrib/common/log";
import {
  classifyMessageComplexity,
  formatMessageComplexity,
  type MessageComplexity,
  type MessageComplexityContext,
} from "./complexity.ts";
import { loadConfig, registerUserMessageConfigItems, setClassifierRegistry } from "./config.ts";
import { installStickyPrompt } from "./sticky-prompt.ts";

const PREFIX_MARKER = "▌ ";

function complexityClassifier(ctx: ExtensionContext): ClassifierCall | undefined {
  const config = loadConfig();
  if (!config.complexityAssessment) return undefined;
  return createClassifierCall(ctx.modelRegistry, config.classifierModel);
}

function messageKey(message: UserMessage): string {
  return JSON.stringify([message.timestamp, message.content]);
}

function visibleMessageText(message: UserMessage): string {
  const content = message.content;
  const text =
    typeof content === "string"
      ? content
      : content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("");
  const skill = parseSkillBlock(text);
  return skill ? (skill.userMessage ?? "") : text;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function findMarkdownText(v: unknown): string | undefined {
  if (isRecord(v) && typeof v.text === "string") return v.text;
  if (!isRecord(v)) return undefined;
  const children = Array.isArray(v.children) ? v.children : [];
  for (const child of children) {
    const t = findMarkdownText(child);
    if (t !== undefined) return t;
  }
  return undefined;
}

function getThinkingColor(level: string): ThemeColor {
  switch (level) {
    case "minimal":
      return "thinkingMinimal";
    case "low":
      return "thinkingLow";
    case "medium":
      return "thinkingMedium";
    case "high":
      return "thinkingHigh";
    case "xhigh":
      return "thinkingXhigh";
    case "max":
      return "thinkingMax";
    default:
      return "thinkingOff";
  }
}

function styledLine(line: string, width: number, theme: Theme | undefined, color: ThemeColor): string {
  const prefix = theme ? theme.fg(color, PREFIX_MARKER) : PREFIX_MARKER;
  const contentWidth = Math.max(1, width - visibleWidth(prefix));
  const clipped = truncateToWidth(line, contentWidth, "");
  const text = theme ? theme.fg("userMessageText", theme.italic(clipped)) : clipped;
  const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)));
  return `${prefix}${text}${padding}`;
}

interface UserMessageRenderCacheEntry {
  text: string;
  width: number;
  theme: Theme | undefined;
  color: ThemeColor;
  complexityLabel: string | undefined;
  lines: string[];
}

const userMessageRenderCache = new WeakMap<UserMessageComponent, UserMessageRenderCacheEntry>();

function renderUserMessage(
  instance: UserMessageComponent,
  width: number,
  theme: Theme | undefined,
  color: ThemeColor,
  getComplexity: (instance: UserMessageComponent, text: string) => MessageComplexity | undefined,
): string[] | undefined {
  const text = findMarkdownText(instance);
  if (text === undefined) return undefined;

  const complexity = getComplexity(instance, text);
  const complexityLabel = complexity ? `  ${formatMessageComplexity(complexity)}` : undefined;
  const cached = userMessageRenderCache.get(instance);
  if (
    cached &&
    cached.text === text &&
    cached.width === width &&
    cached.theme === theme &&
    cached.color === color &&
    cached.complexityLabel === complexityLabel
  ) {
    return cached.lines;
  }

  const prefixWidth = 3;
  const contentWidth = Math.max(1, width - prefixWidth);
  const renderer = new Markdown(text, 0, 0, getMarkdownTheme());
  const lines = renderer.render(contentWidth);
  const body = lines.length > 0 ? lines : [""];

  const rendered = ["", ...body.map((line) => styledLine(line, width, theme, color))];
  if (complexityLabel) {
    rendered.push(truncateToWidth(theme ? theme.fg("muted", complexityLabel) : complexityLabel, width, "…"));
  }
  const result = rendered.map((line) => truncateToWidth(line, width, ""));
  userMessageRenderCache.set(instance, { text, width, theme, color, complexityLabel, lines: result });
  return result;
}

function patchUserMessageRender(
  getTheme: () => Theme | undefined,
  getThinkingLevel: () => string,
  getComplexity: (instance: UserMessageComponent, text: string) => MessageComplexity | undefined,
): void {
  const proto = UserMessageComponent.prototype as UserMessageComponent & {
    __patched?: boolean;
    __getTheme?: () => Theme | undefined;
    __getThinkingLevel?: () => string;
    __getComplexity?: (instance: UserMessageComponent, text: string) => MessageComplexity | undefined;
  };
  proto.__getTheme = getTheme;
  proto.__getThinkingLevel = getThinkingLevel;
  proto.__getComplexity = getComplexity;

  if (proto.__patched) return;

  const originalRender = proto.render;
  proto.render = function (width: number): string[] {
    const theme = proto.__getTheme?.();
    const color = getThinkingColor(proto.__getThinkingLevel?.() ?? "off");
    const custom = renderUserMessage(this, width, theme, color, (instance, text) =>
      proto.__getComplexity?.(instance, text),
    );
    return custom ?? originalRender.call(this, width);
  };
  const originalInvalidate = proto.invalidate;
  proto.invalidate = function (): void {
    userMessageRenderCache.delete(this);
    originalInvalidate.call(this);
  };
  proto.__patched = true;
}

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled("user-message")) return;
  let activeTheme: Theme | undefined;
  let activeThinkingLevel = "off";
  let tui: TUI | undefined;
  let removeStickyPrompt: (() => void) | undefined;
  let isTui = false;
  const pendingMessages = new Map<string, UserMessage>();
  const messageKeys = new Map<string, string[]>();
  let componentKeys = new WeakMap<UserMessageComponent, string>();
  const logger = createLogger("user-message");
  const annotations = new AsyncAnnotations<MessageComplexity>(
    () => {
      tui?.invalidate();
      tui?.requestRender();
    },
    (error) => logger.warn(`Message complexity assessment failed: ${String(error)}`),
  );

  const getTheme = () => activeTheme;
  const getThinkingLevel = () => activeThinkingLevel;
  const getComplexity = (instance: UserMessageComponent, text: string) => {
    let key = componentKeys.get(instance);
    if (key === undefined) {
      const context = findComponentContext(tui, instance);
      if (!context) return undefined;
      const occurrence = context.siblings
        .slice(0, context.index)
        .filter((sibling) => sibling instanceof UserMessageComponent && findMarkdownText(sibling) === text).length;
      key = messageKeys.get(text)?.[occurrence];
      if (key === undefined) return undefined;
      componentKeys.set(instance, key);
    }
    return annotations.get(key);
  };

  const refreshMessageKeys = (ctx: ExtensionContext) => {
    messageKeys.clear();
    componentKeys = new WeakMap();
    for (const message of buildSessionContext(ctx.sessionManager.getBranch()).messages) {
      if (message.role !== "user") continue;
      const text = visibleMessageText(message);
      if (!text) continue;
      const keys = messageKeys.get(text) ?? [];
      keys.push(messageKey(message));
      messageKeys.set(text, keys);
    }
  };

  patchUserMessageRender(getTheme, getThinkingLevel, getComplexity);

  pi.on("session_start", (_event, ctx) => {
    removeStickyPrompt?.();
    removeStickyPrompt = undefined;
    annotations.reset();
    pendingMessages.clear();
    messageKeys.clear();
    componentKeys = new WeakMap();
    isTui = ctx.mode === "tui";
    setClassifierRegistry(ctx.modelRegistry);
    if (!isTui) return;
    refreshMessageKeys(ctx);
    registerUserMessageConfigItems();
    activeTheme = ctx.ui.theme;
    activeThinkingLevel = pi.getThinkingLevel();
    ctx.ui.setWidget("user-message:render-handle", (ui) => {
      tui = ui;
      removeStickyPrompt?.();
      const dispose = installStickyPrompt(ui);
      removeStickyPrompt = dispose;
      return { render: () => [], invalidate() {}, dispose };
    });
    patchUserMessageRender(getTheme, getThinkingLevel, getComplexity);
  });

  pi.on("message_start", (event, ctx) => {
    if (!isTui || event.message.role !== "user" || !complexityClassifier(ctx)) return;
    const text = visibleMessageText(event.message);
    if (!text.trim()) return;
    pendingMessages.set(messageKey(event.message), event.message);
  });

  pi.on("context", (event, ctx) => {
    if (!isTui || pendingMessages.size === 0) return;
    const messages = [...pendingMessages];
    pendingMessages.clear();
    try {
      refreshMessageKeys(ctx);
      const classify = complexityClassifier(ctx);
      if (!classify) return;
      const context: MessageComplexityContext = {
        systemPrompt: ctx.getSystemPrompt(),
        messages: structuredClone(event.messages),
      };
      for (const [key, message] of messages) {
        annotations.request(
          key,
          (signal) => classifyMessageComplexity(visibleMessageText(message), context, signal, classify),
          ctx.signal,
        );
      }
    } catch (error) {
      logger.warn(`Message complexity setup failed: ${String(error)}`);
    }
  });

  const onContextChanged = (_event: unknown, ctx: ExtensionContext) => {
    if (!isTui) return;
    pendingMessages.clear();
    refreshMessageKeys(ctx);
  };
  pi.on("session_tree", onContextChanged);
  pi.on("session_compact", onContextChanged);

  pi.on("agent_end", () => {
    pendingMessages.clear();
  });

  pi.on("session_shutdown", () => {
    removeStickyPrompt?.();
    removeStickyPrompt = undefined;
    isTui = false;
    annotations.dispose();
    pendingMessages.clear();
    messageKeys.clear();
    componentKeys = new WeakMap();
    tui = undefined;
  });

  pi.on("thinking_level_select", (event) => {
    activeThinkingLevel = event.level;
  });

  pi.on("before_agent_start", () => {
    activeThinkingLevel = pi.getThinkingLevel();
    patchUserMessageRender(getTheme, getThinkingLevel, getComplexity);
  });
}
