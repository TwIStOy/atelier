import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EDITOR_HINT_EVENT, type EditorHintPayload } from "@htwang-contrib/common";
import { MyEditor } from "./editor.ts";
import { makeFooter } from "./footer.ts";

export default function (pi: ExtensionAPI) {
  let activeCtx: ExtensionContext | undefined;
  let activeEditor: MyEditor | undefined;
  let unsubscribeHint: (() => void) | undefined;

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    activeCtx = ctx;
    activeEditor = undefined;
    unsubscribeHint?.();
    unsubscribeHint = undefined;

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = new MyEditor(tui, theme, keybindings, () => activeCtx ?? ctx, pi);
      activeEditor = editor;
      return editor;
    });

    unsubscribeHint = pi.events.on(EDITOR_HINT_EVENT, (data: unknown) => {
      activeEditor?.applyHint(data as EditorHintPayload);
    });

    ctx.ui.setFooter(makeFooter(ctx, pi));
  });

  pi.on("session_shutdown", () => {
    activeCtx = undefined;
    activeEditor = undefined;
    unsubscribeHint?.();
    unsubscribeHint = undefined;
  });
}
