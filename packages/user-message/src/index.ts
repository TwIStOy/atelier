import {
  type ExtensionAPI,
  getMarkdownTheme,
  parseSkillBlock,
  type Theme,
  type ThemeColor,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Markdown, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  AsyncAnnotations,
  createLogger,
  isExtensionDisabled,
  loadSystemOneConfig,
  registerSystemOneConfigItems,
} from "@htwang-contrib/common";
import { classifyMessageComplexity, formatMessageComplexity, type MessageComplexity } from "./complexity.ts";

const PREFIX_MARKER = "▌ ";

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

function renderUserMessage(
  instance: unknown,
  width: number,
  theme: Theme | undefined,
  color: ThemeColor,
  getComplexity: (text: string) => MessageComplexity | undefined,
): string[] | undefined {
  const text = findMarkdownText(instance);
  if (text === undefined) return undefined;

  const prefixWidth = 3;
  const contentWidth = Math.max(1, width - prefixWidth);
  const renderer = new Markdown(text, 0, 0, getMarkdownTheme());
  const lines = renderer.render(contentWidth);
  const body = lines.length > 0 ? lines : [""];

  const rendered = ["", ...body.map((line) => styledLine(line, width, theme, color))];
  const complexity = getComplexity(text);
  if (complexity) {
    const label = `  ${formatMessageComplexity(complexity)}`;
    rendered.push(truncateToWidth(theme ? theme.fg("muted", label) : label, width, "…"));
  }
  return rendered.map((line) => truncateToWidth(line, width, ""));
}

function patchUserMessageRender(
  getTheme: () => Theme | undefined,
  getThinkingLevel: () => string,
  getComplexity: (text: string) => MessageComplexity | undefined,
): void {
  const proto = UserMessageComponent.prototype as UserMessageComponent & {
    __patched?: boolean;
    __getTheme?: () => Theme | undefined;
    __getThinkingLevel?: () => string;
    __getComplexity?: (text: string) => MessageComplexity | undefined;
  };
  proto.__getTheme = getTheme;
  proto.__getThinkingLevel = getThinkingLevel;
  proto.__getComplexity = getComplexity;

  if (proto.__patched) return;

  const originalRender = proto.render;
  proto.render = function (width: number): string[] {
    const theme = proto.__getTheme?.();
    const color = getThinkingColor(proto.__getThinkingLevel?.() ?? "off");
    const custom = renderUserMessage(this, width, theme, color, (text) => proto.__getComplexity?.(text));
    return custom ?? originalRender.call(this, width);
  };
  proto.__patched = true;
}

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled("user-message")) return;
  let activeTheme: Theme | undefined;
  let activeThinkingLevel = "off";
  let tui: TUI | undefined;
  let isTui = false;
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
  const getComplexity = (text: string) => annotations.get(text);

  patchUserMessageRender(getTheme, getThinkingLevel, getComplexity);

  pi.on("session_start", (_event, ctx) => {
    annotations.reset();
    isTui = ctx.mode === "tui";
    if (!isTui) return;
    registerSystemOneConfigItems();
    activeTheme = ctx.ui.theme;
    activeThinkingLevel = pi.getThinkingLevel();
    ctx.ui.setWidget("user-message:render-handle", (ui) => {
      tui = ui;
      return { render: () => [], invalidate() {} };
    });
    patchUserMessageRender(getTheme, getThinkingLevel, getComplexity);
  });

  pi.on("message_start", (event, ctx) => {
    if (!isTui || event.message.role !== "user" || !loadSystemOneConfig().apiKey?.trim()) return;
    const content = event.message.content;
    const renderedText =
      typeof content === "string"
        ? content
        : content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("");
    const skill = parseSkillBlock(renderedText);
    const text = skill ? (skill.userMessage ?? "") : renderedText;
    if (!text.trim()) return;
    annotations.request(text, (signal) => classifyMessageComplexity(text, signal), ctx.signal);
  });

  pi.on("session_shutdown", () => {
    isTui = false;
    annotations.dispose();
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
