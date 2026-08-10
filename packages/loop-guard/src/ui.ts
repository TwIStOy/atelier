import type { ExtensionAPI, MessageRenderer, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const RECOVERY_MESSAGE_TYPE = "loop-guard:recovery";

const MAX_BOX_WIDTH = 100;
const MIN_BOX_WIDTH = 24;
const CONTENT_PADDING_X = 1;
const DISPLAY_PREFIX = /^\[loop-guard\]\s*/;

class RecoveryMessageComponent implements Component {
  private readonly content: string;
  private readonly theme: Theme;

  constructor(content: string, theme: Theme) {
    this.content = content;
    this.theme = theme;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const border = (s: string) => this.theme.fg("warning", s);
    const label = ` ${this.theme.fg("warning", "\x1b[1mloop-guard\x1b[22m")} `;
    const labelWidth = visibleWidth(label);

    const display = this.content.replace(DISPLAY_PREFIX, "").replace(/\t/g, "   ");
    const maxInner = Math.max(MIN_BOX_WIDTH, Math.min(width, MAX_BOX_WIDTH)) - 2;
    const wrapped = wrapTextWithAnsi(display, Math.max(1, maxInner - CONTENT_PADDING_X * 2));
    const contentWidth = wrapped.reduce((max, line) => Math.max(max, visibleWidth(line) + CONTENT_PADDING_X * 2), 0);
    const inner = Math.min(maxInner, Math.max(contentWidth, labelWidth + 2));

    const topFill = Math.max(0, inner - labelWidth - 1);
    const lines = [`${border("╭─")}${label}${border("─".repeat(topFill))}${border("╮")}`];
    for (const line of wrapped) {
      const clipped = truncateToWidth(line, inner - CONTENT_PADDING_X, "");
      const padding = " ".repeat(Math.max(0, inner - CONTENT_PADDING_X - visibleWidth(clipped)));
      lines.push(`${border("│")}${" ".repeat(CONTENT_PADDING_X)}${clipped}${padding}${border("│")}`);
    }
    lines.push(`${border("╰")}${border("─".repeat(inner))}${border("╯")}`);
    return lines;
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: "text"; text: string } => {
        return (
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string"
        );
      })
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

const renderer: MessageRenderer = (message, _options, theme) => {
  return new RecoveryMessageComponent(extractText(message.content), theme);
};

export function registerRecoveryRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer(RECOVERY_MESSAGE_TYPE, renderer);
}
