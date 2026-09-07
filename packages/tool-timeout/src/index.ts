import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled } from "@htwang-contrib/common";
import { CONFIG_ID, loadConfig, registerConfig, resolveBashTimeoutSeconds } from "./config.ts";

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled(CONFIG_ID)) return;
  registerConfig();

  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return;
    const max = loadConfig().maxTimeoutSeconds;
    if (max <= 0) return;
    event.input.timeout = resolveBashTimeoutSeconds(event.input.timeout, max);
  });
}
