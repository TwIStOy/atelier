import type {
  ExtensionCommandContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import {
  Key,
  type Component,
  type OverlayOptions,
  type TUI,
  fuzzyFilter,
  matchesKey,
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
          const ctrl = new ModelSelectController(
            tui,
            theme,
            models,
            currentModel,
            resolve,
            done,
          );
          if (
            defaultIndex != null &&
            defaultIndex >= 0 &&
            defaultIndex < models.length
          ) {
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

    lines.push(
      this.theme.bg(
        "selectedBg",
        truncateToWidth(
          ` Select commit model  ${this.query ? `(${this.filtered.length})` : `(${this.entries.length})`}`,
          width,
          "…",
          true,
        ),
      ),
    );

    const promptLine = `  ${this.theme.fg("accent", ">")} ${this.query}${this.theme.fg("dim", "█")}`;
    lines.push(promptLine);
    lines.push("");

    const maxVisible = Math.max(
      3,
      Math.floor(this.tui.terminal.rows * 0.6 - 6),
    );
    const visible = this.filtered.slice(
      this.scrollOffset,
      this.scrollOffset + maxVisible,
    );

    for (let i = 0; i < visible.length; i++) {
      const entry = visible[i];
      const realIdx = this.scrollOffset + i;
      const selected = realIdx === this.cursorIndex;
      const isCurrent =
        this.currentModel &&
        entry.model.provider === this.currentModel.provider &&
        entry.model.id === this.currentModel.id;

      const marker = isCurrent ? " ✓" : "  ";
      const prefix = selected ? this.theme.bg("selectedBg", marker) : marker;

      const label = selected
        ? this.theme.bg("selectedBg", truncateToWidth(entry.label, width - 4))
        : truncateToWidth(entry.label, width - 4);

      lines.push(prefix + label);
    }

    if (this.filtered.length === 0 && this.query) {
      lines.push(this.theme.fg("dim", "  No matches"));
    }

    lines.push("");
    const footer: string[] = [
      this.theme.fg("dim", "Enter") + " select",
      this.theme.fg("dim", "Esc") + " cancel",
      this.theme.fg("dim", "↑↓") + " navigate",
    ];
    lines.push(this.theme.fg("dim", footer.join("  ")));

    return lines;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      if (this.query) {
        this.query = "";
        this.applyFilter();
        this.cursorIndex = 0;
        this.scrollOffset = 0;
        this.invalidate();
        return;
      }
      this.resolve(undefined);
      this.done();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      if (this.filtered.length === 0) return;
      const entry = this.filtered[this.cursorIndex];
      if (!entry) return;
      this.resolve(entry.model);
      this.done();
      return;
    }

    if (matchesKey(data, Key.up)) {
      if (this.cursorIndex > 0) {
        this.cursorIndex--;
        this.adjustScroll();
        this.invalidate();
      }
      return;
    }

    if (matchesKey(data, Key.down)) {
      if (this.cursorIndex < this.filtered.length - 1) {
        this.cursorIndex++;
        this.adjustScroll();
        this.invalidate();
      }
      return;
    }

    if (matchesKey(data, Key.backspace)) {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.applyFilter();
        this.cursorIndex = Math.min(
          this.cursorIndex,
          Math.max(0, this.filtered.length - 1),
        );
        this.scrollOffset = 0;
        this.invalidate();
      }
      return;
    }

    if (data === "\x15" || data === "\x17") {
      this.query = "";
      this.applyFilter();
      this.cursorIndex = 0;
      this.scrollOffset = 0;
      this.invalidate();
      return;
    }

    if (data.length === 1 && data >= " ") {
      this.query += data;
      this.applyFilter();
      this.cursorIndex = 0;
      this.scrollOffset = 0;
      this.invalidate();
    }
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
    const maxVisible = Math.max(
      3,
      Math.floor(this.tui.terminal.rows * 0.6 - 6),
    );
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
