import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { EditorHintPayload } from "@htwang-contrib/common";
import { loadConfig } from "./config.ts";

const MIN_BODY_LINES = 1;
const PROMPT_PREFIX_WIDTH = 2;

function formatAbbreviatedCount(value: number, divisor: number, suffix: string): string {
  const scaled = (value / divisor).toFixed(1);
  const num = scaled.endsWith(".0") ? scaled.slice(0, -2) : scaled;
  return `${num}${suffix}`;
}

function formatCount(value: number | null | undefined): string {
  if (value == null) return "?";
  if (value >= 1_000_000) return formatAbbreviatedCount(value, 1_000_000, "M");
  if (value >= 1_000) return formatAbbreviatedCount(value, 1_000, "K");
  return String(value);
}

function formatCost(value: number): string {
  if (value === 0) return "$0.000";
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function isEditorRule(line: string): boolean {
  const plain = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
  return plain.includes("─") && [...plain].every((c) => "─↑↓ 0123456789more".includes(c));
}

function splitEditorRender(lines: string[]): {
  editorLines: string[];
  popupLines: string[];
} {
  const withoutTop = lines.slice(1);
  const bottomRuleIndex = withoutTop.findIndex(isEditorRule);
  if (bottomRuleIndex === -1) {
    return { editorLines: withoutTop, popupLines: [] };
  }
  return {
    editorLines: withoutTop.slice(0, bottomRuleIndex),
    popupLines: withoutTop.slice(bottomRuleIndex + 1),
  };
}

function getSessionCost(ctx: ExtensionContext): number {
  let total = 0;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const cost = entry.message.usage?.cost?.total;
    if (typeof cost === "number" && Number.isFinite(cost)) total += cost;
  }
  return total;
}

export class MyEditor extends CustomEditor {
  private readonly hints = new Map<string, { text: string; color: ThemeColor }>();

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly getCtx: () => ExtensionContext,
    private readonly pi: ExtensionAPI,
  ) {
    super(tui, theme, keybindings, { paddingX: 0 });
    this.applyBorderColor();
  }

  applyHint(payload: EditorHintPayload): void {
    if (!payload || typeof payload.source !== "string") return;
    if (payload.text == null || payload.text === "") {
      if (!this.hints.has(payload.source)) return;
      this.hints.delete(payload.source);
    } else {
      const color = payload.color ?? "warning";
      this.hints.delete(payload.source);
      this.hints.set(payload.source, { text: payload.text, color });
    }
    this.tui.requestRender();
  }

  private activeHint(): { text: string; color: ThemeColor } | null {
    let last: { text: string; color: ThemeColor } | null = null;
    for (const v of this.hints.values()) last = v;
    return last;
  }

  private get ctx(): ExtensionContext {
    return this.getCtx();
  }

  private fg(color: ThemeColor, text: string): string {
    return this.ctx.ui.theme.fg(color, text);
  }

  /**
   * Pi reapplies the thinking-level border color whenever the level changes,
   * overriding any color set once, so re-assert the configured fixed color on
   * every render. Bash mode (leading "!") keeps its dedicated border color.
   */
  private applyBorderColor(): void {
    const mode = loadConfig().borderColor;
    if (mode === "thinkingLevel") return;
    if (this.getText().trimStart().startsWith("!")) return;
    this.borderColor = (s: string) => this.fg(mode, s);
  }

  render(width: number): string[] {
    this.applyBorderColor();
    if (width < 12) return super.render(width);

    const innerWidth = Math.max(1, width - 2);
    const base = super.render(Math.max(1, innerWidth - PROMPT_PREFIX_WIDTH));
    const { editorLines, popupLines } = splitEditorRender(base);
    const body = editorLines.map((line, index) => this.withPromptPrefix(line, index));

    while (body.length < MIN_BODY_LINES) {
      body.push(" ".repeat(innerWidth));
    }

    const leftTop = this.getUsageLabel();
    const rightTop = this.getModelLabel(Math.max(8, Math.floor(innerWidth * 0.48)));
    const cwdLabel = this.getCwdLabel();
    const hint = this.activeHint();

    return [
      this.borderWithLabels(width, leftTop, rightTop, hint),
      ...body.map((line) => this.wrapBody(line, innerWidth)),
      this.borderWithRightLabel(width, cwdLabel),
      ...this.wrapPopupBlock(popupLines, width),
    ];
  }

  private getUsageLabel(): string {
    const usage = this.ctx.getContextUsage();
    const pct = usage?.percent == null ? "?" : `${Math.max(0, Math.floor(usage.percent))}%`;
    const contextWindow = (usage?.contextWindow ?? this.ctx.model?.contextWindow) || null;
    const parts = [` ${pct} of ${formatCount(contextWindow)}`];

    const cost = getSessionCost(this.ctx);
    if (cost > 0) {
      parts.push(formatCost(cost));
    }

    return `${parts.join(" · ")} `;
  }

  private getModelLabel(maxWidth: number): string {
    const model = this.ctx.model;
    const name = model?.name ?? "model unknown";
    const level = this.pi.getThinkingLevel();
    const reasoning = model?.reasoning && level !== "off";
    const parts = [name];
    if (reasoning) {
      parts.push("🧠");
      if (level !== "medium" && level !== "minimal") {
        parts.push(level);
      }
    }
    const label = parts.join(" ");
    const text = this.fg("text", truncateToWidth(label, maxWidth, "…"));
    return ` ${text} `;
  }

  private getCwdLabel(): string {
    const cwd = this.ctx.cwd;
    const home = process.env.HOME ?? "";
    const displayCwd = cwd === home ? "~" : cwd.startsWith(`${home}/`) ? `~/${cwd.slice(home.length + 1)}` : cwd;
    return ` ${displayCwd} `;
  }

  /**
   * First body line renders the shell-style `❯ ` prompt; continuations get a
   * matching 2-column hang indent. The gutter is drawn here (constructor uses
   * `paddingX: 0`) because slicing the rendered line to re-insert the prefix
   * corrupts pi-tui's zero-width CURSOR_MARKER downstream (its ESC gets eaten
   * and the marker leaks into the terminal as literal `_pi:c`).
   */
  private withPromptPrefix(line: string, index: number): string {
    const prompt = index === 0 ? `${this.fg("accent", "❯")} ` : "  ";
    return ` ${prompt}${line}`;
  }

  private wrapBody(line: string, innerWidth: number): string {
    const clipped = truncateToWidth(line, innerWidth, "");
    const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
    return this.sideBorder() + clipped + padding + this.sideBorder();
  }

  private wrapPopupBlock(lines: string[], width: number): string[] {
    if (lines.length === 0) return [];
    return lines.map((line) => {
      const clipped = truncateToWidth(line, width, "");
      const padding = " ".repeat(Math.max(0, width - visibleWidth(clipped)));
      return clipped + padding;
    });
  }

  private borderWithLabels(
    width: number,
    leftLabel: string,
    rightLabel: string,
    hint: { text: string; color: ThemeColor } | null,
  ): string {
    const innerWidth = Math.max(0, width - 2);
    const maxLeft = Math.max(0, Math.floor(innerWidth * 0.44));
    const maxRight = Math.max(0, innerWidth - maxLeft - 2);
    const left = this.fg("muted", truncateToWidth(leftLabel, maxLeft, "…"));
    const right = truncateToWidth(rightLabel, maxRight, "…");
    return this.borderColor("╭") + left + this.topMiddle(innerWidth, left, right, hint) + right + this.borderColor("╮");
  }

  private topMiddle(
    innerWidth: number,
    left: string,
    right: string,
    hint: { text: string; color: ThemeColor } | null,
  ): string {
    const remaining = Math.max(0, innerWidth - visibleWidth(left) - visibleWidth(right));
    if (!hint) return this.borderColor("─".repeat(remaining));
    const colored = this.fg(hint.color, truncateToWidth(hint.text, Math.max(0, remaining - 2), "…"));
    if (visibleWidth(colored) === 0) return this.borderColor("─".repeat(remaining));
    const dashes = Math.max(0, remaining - visibleWidth(colored) - 2);
    return ` ${colored} ${this.borderColor("─".repeat(dashes))}`;
  }

  private sideBorder(): string {
    return this.borderColor("│");
  }

  private borderWithRightLabel(width: number, label: string): string {
    const innerWidth = Math.max(0, width - 2);
    const right = this.fg("muted", truncateToWidth(label, Math.max(0, innerWidth - 2), "…"));
    const fill = Math.max(0, innerWidth - visibleWidth(right));
    return this.borderColor("╰") + this.borderColor("─".repeat(fill)) + right + this.borderColor("╯");
  }
}
