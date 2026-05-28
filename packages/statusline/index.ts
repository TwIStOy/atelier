import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { makeFooter } from "./footer.ts";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setFooter(makeFooter(ctx, pi));
  });

  pi.on("session_shutdown", () => {});
}
