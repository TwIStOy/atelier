import { CustomEditor, type ExtensionAPI, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorComponent, EditorTheme, TUI } from "@earendil-works/pi-tui";
import {
  chainEditorFactory,
  EDITOR_HINT_EVENT,
  type EditorHintPayload,
  registerConfigItems,
} from "@htwang-contrib/common";
import { DEBOUNCE_MAX_MS, DEBOUNCE_MIN_MS, HINT_TEXT, loadDoubleEscapeConfig } from "./config.ts";
import { DoubleEscapeController } from "./state-machine.ts";

const EXTENSION_LABEL = "Experience";
const HINT_SOURCE = "double-escape";

type EditorFactory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent;
type AutocompleteAware = { isShowingAutocomplete?: () => boolean };

function registerDoubleEscapeConfig(): void {
  registerConfigItems("experience", [
    {
      key: "doubleEscapeEnabled",
      type: "boolean",
      label: "Double-Escape to Abort",
      value: () => loadDoubleEscapeConfig().doubleEscapeEnabled,
      description:
        "When on, aborting a streaming response requires two Escape presses: the first arms an 'esc again to abort' hint (rendered in the editor border by extensions such as statusline), the second within the debounce window aborts. When off, or while not streaming, Escape aborts immediately. Autocomplete dismissal always uses a single Escape.",
      extensionLabel: EXTENSION_LABEL,
      order: 20,
    },
    {
      key: "doubleEscapeDebounceMs",
      type: "number",
      label: "Double-Escape Window (ms)",
      value: () => loadDoubleEscapeConfig().doubleEscapeDebounceMs,
      min: DEBOUNCE_MIN_MS,
      max: DEBOUNCE_MAX_MS,
      description:
        "How long the 'esc again to abort' hint stays armed after the first Escape while streaming. A second Escape within this window aborts; otherwise the hint clears and Escape resets.",
      extensionLabel: EXTENSION_LABEL,
      order: 30,
    },
  ]);
}

export function registerDoubleEscape(pi: ExtensionAPI): void {
  registerDoubleEscapeConfig();

  let isStreaming = false;
  let activeController: DoubleEscapeController | undefined;
  let activeInner: EditorComponent | undefined;

  const emitHint = (text: string | null): void => {
    const payload: EditorHintPayload = { source: HINT_SOURCE, text, color: "warning" };
    pi.events.emit(EDITOR_HINT_EVENT, payload);
  };

  pi.on("agent_start", () => {
    isStreaming = true;
  });

  pi.on("agent_end", () => {
    isStreaming = false;
    activeController?.reset();
  });

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    isStreaming = false;
    activeInner = undefined;

    const controller = new DoubleEscapeController({
      isStreaming: () => isStreaming,
      isShowingAutocomplete: () => (activeInner as AutocompleteAware | undefined)?.isShowingAutocomplete?.() ?? false,
      debounceMs: () => loadDoubleEscapeConfig().doubleEscapeDebounceMs,
      onChange: () => {
        const text = controller.isArmed() && loadDoubleEscapeConfig().doubleEscapeEnabled ? HINT_TEXT : null;
        emitHint(text);
      },
    });
    activeController = controller;

    ctx.ui.setEditorComponent(
      chainEditorFactory<EditorFactory>(ctx.ui.getEditorComponent(), (parent) => (tui, theme, keybindings) => {
        const inner: EditorComponent = parent
          ? parent(tui, theme, keybindings)
          : new CustomEditor(tui, theme, keybindings);
        activeInner = inner;
        patchEscapeIntercept(inner, keybindings, controller);
        return inner;
      }),
    );
  });

  pi.on("session_shutdown", () => {
    isStreaming = false;
    activeController?.reset();
    activeController = undefined;
    activeInner = undefined;
  });
}

function patchEscapeIntercept(
  inner: EditorComponent,
  keybindings: KeybindingsManager,
  controller: DoubleEscapeController,
): void {
  const original = inner.handleInput?.bind(inner);
  inner.handleInput = (data: string) => {
    if (loadDoubleEscapeConfig().doubleEscapeEnabled && keybindings.matches(data, "app.interrupt")) {
      const outcome = controller.handleEscape();
      if (outcome === "arm") return;
    }
    original?.(data);
  };
}
