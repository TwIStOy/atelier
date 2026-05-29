import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { makeFooter } from "./footer.ts";
import { MyEditor } from "./editor.ts";

export default function (pi: ExtensionAPI) {
  let activeCtx: ExtensionContext | undefined;

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    activeCtx = ctx;

    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) =>
        new MyEditor(tui, theme, keybindings, () => activeCtx ?? ctx, pi),
    );

    ctx.ui.setFooter(makeFooter(ctx, pi));
  });

  pi.on("session_shutdown", () => {
    activeCtx = undefined;
  });
}
