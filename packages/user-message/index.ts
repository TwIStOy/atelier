import {
  getMarkdownTheme,
  Theme,
  UserMessageComponent,
  type ExtensionAPI,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
  Markdown,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

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
    default:
      return "thinkingOff";
  }
}

function styledLine(
  line: string,
  width: number,
  theme: Theme | undefined,
  color: ThemeColor,
): string {
  const prefix = theme ? theme.fg(color, PREFIX_MARKER) : PREFIX_MARKER;
  const contentWidth = Math.max(1, width - visibleWidth(prefix));
  const clipped = truncateToWidth(line, contentWidth, "");
  const text = theme
    ? theme.fg("userMessageText", theme.italic(clipped))
    : clipped;
  const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)));
  return `${prefix}${text}${padding}`;
}

function renderUserMessage(
  instance: any,
  width: number,
  theme: Theme | undefined,
  color: ThemeColor,
): string[] | undefined {
  const text = findMarkdownText(instance);
  if (text === undefined) return undefined;

  const prefixWidth = 3;
  const contentWidth = Math.max(1, width - prefixWidth);
  const renderer = new Markdown(text, 0, 0, getMarkdownTheme());
  const lines = renderer.render(contentWidth);
  const body = lines.length > 0 ? lines : [""];

  return ["", ...body.map((line) => styledLine(line, width, theme, color))];
}

function patchUserMessageRender(
  getTheme: () => Theme | undefined,
  getThinkingLevel: () => string,
): void {
  const proto: any = UserMessageComponent.prototype;
  proto.__getTheme = getTheme;
  proto.__getThinkingLevel = getThinkingLevel;

  if (proto.__patched) return;

  const originalRender = proto.render;
  proto.render = function (width: number): string[] {
    const theme = proto.__getTheme?.();
    const color = getThinkingColor(proto.__getThinkingLevel() ?? "off");
    const custom = renderUserMessage(this, width, theme, color);
    return custom ?? originalRender.call(this, width);
  };
  proto.__patched = true;
}

export default function (pi: ExtensionAPI) {
  let activeTheme: Theme | undefined;
  let activeThinkingLevel = "off";

  const getTheme = () => activeTheme;
  const getThinkingLevel = () => activeThinkingLevel;

  patchUserMessageRender(getTheme, getThinkingLevel);

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    activeTheme = ctx.ui.theme;
    activeThinkingLevel = pi.getThinkingLevel();
    patchUserMessageRender(getTheme, getThinkingLevel);
  });

  pi.on("thinking_level_select", (event) => {
    activeThinkingLevel = event.level;
  });

  pi.on("before_agent_start", () => {
    activeThinkingLevel = pi.getThinkingLevel();
    patchUserMessageRender(getTheme, getThinkingLevel);
  });
}
