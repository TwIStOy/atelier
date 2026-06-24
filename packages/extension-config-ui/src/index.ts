import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { openConfigPopup } from "./popup.ts";

const INSTALL_GUARD = Symbol.for("pi-extensions.extension-config-ui.installed");

export default function initConfigUI(pi: ExtensionAPI): void {
  const guard = pi as unknown as Record<symbol, boolean>;
  if (guard[INSTALL_GUARD]) return;
  guard[INSTALL_GUARD] = true;

  pi.registerCommand("config", {
    description: "Browse and edit extension configurations",
    handler: async (_args, ctx) => {
      await openConfigPopup(pi, ctx);
    },
  });
}
