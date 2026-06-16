import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("working-indicator", {
    description:
      "Customize the streaming working indicator. (skeleton — not yet implemented)",
    handler: async (_args, ctx) => {
      ctx.ui.notify("working-indicator: skeleton extension loaded", "info");
    },
  });
}
