import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { EDITOR_HINT_EVENT, type EditorHintPayload } from "@htwang-contrib/common/events";
import { isExtensionDisabled } from "@htwang-contrib/common/extension-disable";
import { registerBetterEditorConfigItems } from "./config.ts";
import { BetterEditor } from "./editor.ts";
import { installHistory, registerHistory } from "./history.ts";

export default function (pi: ExtensionAPI): void {
  if (isExtensionDisabled("better-editor")) return;

  registerBetterEditorConfigItems();
  registerHistory(pi);

  let isStreaming = false;
  let activeEditor: BetterEditor | undefined;
  let unsubscribeHint: (() => void) | undefined;

  pi.on("agent_start", () => {
    isStreaming = true;
  });

  pi.on("agent_end", () => {
    isStreaming = false;
    activeEditor?.resetInterrupt();
  });

  pi.on("session_start", (_event, ctx) => {
    isStreaming = false;
    activeEditor?.resetInterrupt();
    activeEditor = undefined;
    unsubscribeHint?.();
    unsubscribeHint = undefined;
    if (ctx.mode !== "tui") return;

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      activeEditor?.resetInterrupt();
      const editor = new BetterEditor(
        tui,
        theme,
        keybindings,
        () => ctx,
        pi,
        () => isStreaming,
      );
      installHistory(editor);
      activeEditor = editor;
      return editor;
    });

    unsubscribeHint = pi.events.on(EDITOR_HINT_EVENT, (data: unknown) => {
      activeEditor?.applyHint(data as EditorHintPayload);
    });
  });

  pi.on("session_shutdown", () => {
    isStreaming = false;
    activeEditor?.resetInterrupt();
    activeEditor = undefined;
    unsubscribeHint?.();
    unsubscribeHint = undefined;
  });
}
