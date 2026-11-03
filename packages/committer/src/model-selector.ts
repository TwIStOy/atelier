import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  fuzzyFilter,
  Key,
  matchesKey,
  type OverlayOptions,
  type TUI,
  truncateToWidth,
} from "@earendil-works/pi-tui";

type AnyModel = Model<any>;

const OVERLAY_OPTIONS: OverlayOptions = {
  anchor: "bottom-center",
  width: "60%",
  maxHeight: "60%",
  margin: { left: 0, right: 0, bottom: 0 },
};

type SelectResult = AnyModel | undefined;

interface ModelEntry {
  model: AnyModel;
  label: string;
  text: string;
}

export class ModelSelectController implements Component {
  private query = "";
  private cursorIndex = 0;
  private filtered: ModelEntry[] = [];
  private scrollOffset = 0;

  private constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly entries: ModelEntry[],
    private readonly currentModel: AnyModel | undefined,
    private readonly resolve: (result: SelectResult) => void,
    private readonly done: () => void,
  ) {
    this.filtered = entries;
  }

  static show(
    ctx: ExtensionCommandContext,
    models: ModelEntry[],
    currentModel: AnyModel | undefined,
    defaultIndex?: number,
  ): Promise<SelectResult> {
    return new Promise<SelectResult>((resolve) => {
      ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) => {
          const ctrl = new ModelSelectController(tui, theme, models, currentModel, resolve, done);
          if (defaultIndex != null && defaultIndex >= 0 && defaultIndex < models.length) {
            ctrl.cursorIndex = defaultIndex;
            ctrl.adjustScroll();
          }
          return ctrl;
        },
        { overlay: true, overlayOptions: OVERLAY_OPTIONS },
      );
    });
  }

  render(width: number): string[] {
    const lines: string[] = [];

    lines.push(this.headerLine(width));
    lines.push(`  ${this.theme.fg("accent", ">")} ${this.query}${this.theme.fg("dim", "█")}`);
    lines.push("");

    const visible = this.visibleEntries();
    for (let i = 0; i < visible.length; i++) {
      lines.push(this.entryLine(visible[i], this.scrollOffset + i, width));
    }

    const noMatch = this.noMatchesLine();
    if (noMatch !== null) lines.push(noMatch);

    lines.push("");
    lines.push(this.theme.fg("dim", this.footerText()));

    return lines;
  }

  private headerLine(width: number): string {
    const count = this.query ? this.filtered.length : this.entries.length;
    return this.theme.bg("selectedBg", truncateToWidth(` Select commit model  (${count})`, width, "…", true));
  }

  private visibleEntries(): ModelEntry[] {
    const maxVisible = Math.max(3, Math.floor(this.tui.terminal.rows * 0.6 - 6));
    return this.filtered.slice(this.scrollOffset, this.scrollOffset + maxVisible);
  }

  private entryLine(entry: ModelEntry, realIdx: number, width: number): string {
    const selected = realIdx === this.cursorIndex;
    const marker = this.isCurrentModel(entry) ? " ✓" : "  ";
    const prefix = selected ? this.theme.bg("selectedBg", marker) : marker;
    const label = selected
      ? this.theme.bg("selectedBg", truncateToWidth(entry.label, width - 4))
      : truncateToWidth(entry.label, width - 4);
    return prefix + label;
  }

  private isCurrentModel(entry: ModelEntry): boolean {
    const current = this.currentModel;
    return !!current && entry.model.provider === current.provider && entry.model.id === current.id;
  }

  private noMatchesLine(): string | null {
    if (this.filtered.length === 0 && this.query) return this.theme.fg("dim", "  No matches");
    return null;
  }

  private footerText(): string {
    const footer: string[] = [
      `${this.theme.fg("dim", "Enter")} select`,
      `${this.theme.fg("dim", "Esc")} cancel`,
      `${this.theme.fg("dim", "↑↓")} navigate`,
    ];
    return footer.join("  ");
  }

  private readonly inputHandlers: Array<(data: string) => boolean> = [
    (data) => this.handleEscapeKey(data),
    (data) => this.handleEnterKey(data),
    (data) => this.handleUpKey(data),
    (data) => this.handleDownKey(data),
    (data) => this.handleBackspaceKey(data),
    (data) => this.handleClearQueryKey(data),
    (data) => this.appendCharKey(data),
  ];

  handleInput(data: string): void {
    for (const handler of this.inputHandlers) {
      if (handler(data)) return;
    }
  }

  private handleEscapeKey(data: string): boolean {
    if (!matchesKey(data, Key.escape)) return false;
    if (this.query) {
      this.query = "";
      this.applyFilter();
      this.cursorIndex = 0;
      this.scrollOffset = 0;
      this.invalidate();
      return true;
    }
    this.resolve(undefined);
    this.done();
    return true;
  }

  private handleEnterKey(data: string): boolean {
    if (!matchesKey(data, Key.enter)) return false;
    if (this.filtered.length === 0) return true;
    const entry = this.filtered[this.cursorIndex];
    if (!entry) return true;
    this.resolve(entry.model);
    this.done();
    return true;
  }

  private handleUpKey(data: string): boolean {
    if (!matchesKey(data, Key.up)) return false;
    if (this.cursorIndex > 0) {
      this.cursorIndex--;
      this.adjustScroll();
      this.invalidate();
    }
    return true;
  }

  private handleDownKey(data: string): boolean {
    if (!matchesKey(data, Key.down)) return false;
    if (this.cursorIndex < this.filtered.length - 1) {
      this.cursorIndex++;
      this.adjustScroll();
      this.invalidate();
    }
    return true;
  }

  private handleBackspaceKey(data: string): boolean {
    if (!matchesKey(data, Key.backspace)) return false;
    if (this.query.length > 0) {
      this.query = this.query.slice(0, -1);
      this.applyFilter();
      this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.filtered.length - 1));
      this.scrollOffset = 0;
      this.invalidate();
    }
    return true;
  }

  private handleClearQueryKey(data: string): boolean {
    if (data !== "\x15" && data !== "\x17") return false;
    this.query = "";
    this.applyFilter();
    this.cursorIndex = 0;
    this.scrollOffset = 0;
    this.invalidate();
    return true;
  }

  private appendCharKey(data: string): boolean {
    if (data.length !== 1 || data < " ") return false;
    this.query += data;
    this.applyFilter();
    this.cursorIndex = 0;
    this.scrollOffset = 0;
    this.invalidate();
    return true;
  }

  invalidate(): void {
    this.tui.requestRender();
  }

  private applyFilter(): void {
    if (!this.query) {
      this.filtered = this.entries;
      return;
    }
    this.filtered = fuzzyFilter(this.entries, this.query, (e) => e.text);
  }

  private adjustScroll(): void {
    const maxVisible = Math.max(3, Math.floor(this.tui.terminal.rows * 0.6 - 6));
    if (this.cursorIndex < this.scrollOffset) {
      this.scrollOffset = this.cursorIndex;
    } else if (this.cursorIndex >= this.scrollOffset + maxVisible) {
      this.scrollOffset = this.cursorIndex - maxVisible + 1;
    }
  }
}

export function buildModelEntries(models: AnyModel[]): ModelEntry[] {
  return models.map((m) => ({
    model: m,
    label: `${m.provider}/${m.id}`,
    text: `${m.provider}/${m.id} ${m.name}`,
  }));
}

export type { SelectResult };
