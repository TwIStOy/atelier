import {
  CustomEditor,
  type ExtensionContext,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";

const MIN_BODY_LINES = 1;

function formatCount(value: number | null | undefined): string {
  if (value == null) return "?";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
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
  return (
    plain.includes("─") &&
    [...plain].every((c) => "─↑↓ 0123456789more".includes(c))
  );
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
    if (entry.type !== "message" || entry.message.role !== "assistant")
      continue;
    const cost = entry.message.usage?.cost?.total;
    if (typeof cost === "number" && Number.isFinite(cost)) total += cost;
  }
  return total;
}

export class AmpEditor extends CustomEditor {
  private editorTheme: EditorTheme;
  private getCtx: () => ExtensionContext;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    getCtx: () => ExtensionContext,
  ) {
    super(tui, theme, keybindings, { paddingX: 1 });
    this.editorTheme = theme;
    this.getCtx = getCtx;
    this.borderColor = (s: string) => this.fg("border", s);
  }

  private get ctx(): ExtensionContext {
    return this.getCtx();
  }

  private fg(color: ThemeColor, text: string): string {
    return this.ctx.ui.theme.fg(color, text);
  }

  render(width: number): string[] {
    if (width < 12) return super.render(width);

    const innerWidth = Math.max(1, width - 2);
    const base = super.render(innerWidth);
    const { editorLines, popupLines } = splitEditorRender(base);
    const body = [...editorLines];

    while (body.length < MIN_BODY_LINES) {
      body.push(" ".repeat(innerWidth));
    }

    const leftTop = this.getUsageLabel();
    const rightTop = this.getModelLabel(
      Math.max(8, Math.floor(innerWidth * 0.48)),
    );
    const cwdLabel = this.getCwdLabel();

    return [
      this.borderWithLabels(width, leftTop, rightTop),
      ...body.map((line) => this.wrapBody(line, innerWidth)),
      this.borderWithRightLabel(width, cwdLabel),
      ...this.wrapPopupBlock(popupLines, width),
    ];
  }

  private getUsageLabel(): string {
    const usage = this.ctx.getContextUsage();
    const pct =
      usage?.percent == null
        ? "?"
        : `${Math.max(0, Math.floor(usage.percent))}%`;
    const contextWindow =
      usage?.contextWindow ?? this.ctx.model?.contextWindow ?? null;
    const parts = [` ${pct} of ${formatCount(contextWindow)}`];

    const cost = getSessionCost(this.ctx);
    if (cost > 0) {
      parts.push(formatCost(cost));
    }

    return `${parts.join(" · ")} `;
  }

  private getModelLabel(maxWidth: number): string {
    const name = this.ctx.model?.name ?? "model unknown";
    const model = this.fg("text", truncateToWidth(name, maxWidth, "…"));
    return ` ${model} `;
  }

  private getCwdLabel(): string {
    const cwd = this.ctx.cwd;
    const home = process.env.HOME ?? "";
    const displayCwd =
      cwd === home
        ? "~"
        : cwd.startsWith(`${home}/`)
          ? `~/${cwd.slice(home.length + 1)}`
          : cwd;
    return ` ${displayCwd} `;
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
  ): string {
    const innerWidth = Math.max(0, width - 2);
    const maxLeft = Math.max(0, Math.floor(innerWidth * 0.44));
    const maxRight = Math.max(0, innerWidth - maxLeft - 2);
    const left = this.fg("muted", truncateToWidth(leftLabel, maxLeft, "…"));
    const right = truncateToWidth(rightLabel, maxRight, "…");
    const used = visibleWidth(left) + visibleWidth(right);
    const fill = Math.max(0, innerWidth - used);
    return (
      this.borderColor("╭") +
      left +
      this.borderColor("─".repeat(fill)) +
      right +
      this.borderColor("╮")
    );
  }

  private sideBorder(): string {
    return this.borderColor("│");
  }

  private borderWithRightLabel(width: number, label: string): string {
    const innerWidth = Math.max(0, width - 2);
    const right = this.fg(
      "muted",
      truncateToWidth(label, Math.max(0, innerWidth - 2), "…"),
    );
    const fill = Math.max(0, innerWidth - visibleWidth(right));
    return (
      this.borderColor("╰") +
      this.borderColor("─".repeat(fill)) +
      right +
      this.borderColor("╯")
    );
  }
}
