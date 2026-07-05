import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { DoubleEscapeController } from "./state-machine.ts";

export interface DoubleEscapeEditorDeps {
  enabled: () => boolean;
  isStreaming: () => boolean;
  debounceMs: () => number;
  hintText: () => string;
  hintColor: (text: string) => string;
}

export class DoubleEscapeEditor extends CustomEditor {
  private readonly keybindingsRef: KeybindingsManager;
  private readonly editorDeps: DoubleEscapeEditorDeps;
  private readonly controller: DoubleEscapeController;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, deps: DoubleEscapeEditorDeps) {
    super(tui, theme, keybindings);
    this.keybindingsRef = keybindings;
    this.editorDeps = deps;
    this.controller = new DoubleEscapeController({
      isStreaming: deps.isStreaming,
      isShowingAutocomplete: () => this.isShowingAutocomplete(),
      debounceMs: deps.debounceMs,
      onChange: () => tui.requestRender(),
    });
  }

  override handleInput(data: string): void {
    if (!this.editorDeps.enabled()) {
      super.handleInput(data);
      return;
    }
    if (this.keybindingsRef.matches(data, "app.interrupt")) {
      const outcome = this.controller.handleEscape();
      if (outcome === "arm") return;
      super.handleInput(data);
      return;
    }
    super.handleInput(data);
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    if (!this.editorDeps.enabled() || !this.controller.isArmed() || lines.length === 0) {
      return lines;
    }
    lines[0] = renderHintBorder(width, this.editorDeps.hintText(), this.borderColor, this.editorDeps.hintColor);
    return lines;
  }

  resetHint(): void {
    this.controller.reset();
  }
}

function renderHintBorder(
  width: number,
  hintText: string,
  borderColor: (text: string) => string,
  hintColor: (text: string) => string,
): string {
  const hintSegment = ` ${hintText} `;
  const minNeeded = visibleWidth(hintSegment) + 2;
  let segment = hintSegment;
  if (width < minNeeded) {
    const avail = Math.max(0, width - 2);
    segment = truncateToWidth(hintSegment, avail, "");
  }
  const dashes = Math.max(0, width - visibleWidth(segment) - 1);
  return `${borderColor("─")}${hintColor(segment)}${borderColor("─".repeat(dashes))}`;
}
