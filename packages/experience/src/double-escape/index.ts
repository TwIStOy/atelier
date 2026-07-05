import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerConfigItems } from "@htwang-contrib/common";
import { DoubleEscapeEditor } from "./abort-editor.ts";
import { DEBOUNCE_MAX_MS, DEBOUNCE_MIN_MS, HINT_TEXT, loadDoubleEscapeConfig } from "./config.ts";

const EXTENSION_LABEL = "Experience";

function registerDoubleEscapeConfig(): void {
  registerConfigItems("experience", [
    {
      key: "doubleEscapeEnabled",
      type: "boolean",
      label: "Double-Escape to Abort",
      value: () => loadDoubleEscapeConfig().doubleEscapeEnabled,
      description:
        "When on, aborting a streaming response requires two Escape presses: the first shows an 'esc again to abort' hint on the editor border, the second within the debounce window aborts. When off, or while not streaming, Escape aborts immediately. Autocomplete dismissal always uses a single Escape.",
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
  let activeEditor: DoubleEscapeEditor | undefined;

  pi.on("agent_start", () => {
    isStreaming = true;
  });

  pi.on("agent_end", () => {
    isStreaming = false;
    activeEditor?.resetHint();
  });

  pi.on("session_start", (_event, ctx) => {
    isStreaming = false;
    activeEditor = undefined;

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = new DoubleEscapeEditor(tui, theme, keybindings, {
        enabled: () => loadDoubleEscapeConfig().doubleEscapeEnabled,
        isStreaming: () => isStreaming,
        debounceMs: () => loadDoubleEscapeConfig().doubleEscapeDebounceMs,
        hintText: () => HINT_TEXT,
        hintColor: (text) => ctx.ui.theme.fg("warning", text),
      });
      activeEditor = editor;
      return editor;
    });
  });

  pi.on("session_shutdown", () => {
    isStreaming = false;
    activeEditor?.resetHint();
    activeEditor = undefined;
  });
}
