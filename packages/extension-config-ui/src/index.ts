import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled } from "@htwang-contrib/common";
import { openConfigPopup } from "./popup.ts";

const INSTALL_GUARD = Symbol.for("pi-extensions.extension-config-ui.installed");

export default function initConfigUI(pi: ExtensionAPI): void {
  if (isExtensionDisabled("extension-config-ui")) return;
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
