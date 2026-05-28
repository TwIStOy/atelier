import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { makeAboveWidget } from "./above-widget.ts";
import { makeBelowWidget } from "./below-widget.ts";
import { makeFooter } from "./footer.ts";

export default function (pi: ExtensionAPI) {
    pi.on("session_start", async (_event, ctx) => {
        if (!ctx.hasUI) return;

        ctx.ui.setWidget("statusline-above", makeAboveWidget(ctx), { placement: "aboveEditor" });
        ctx.ui.setWidget("statusline-below", makeBelowWidget(ctx), { placement: "belowEditor" });
        ctx.ui.setFooter(makeFooter(ctx));
    });

    pi.on("session_shutdown", () => {});
}
