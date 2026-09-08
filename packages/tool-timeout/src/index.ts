import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled } from "@htwang-contrib/common";
import { CONFIG_ID, loadConfig, matchesExemptRule, registerConfig, resolveBashTimeoutSeconds } from "./config.ts";

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled(CONFIG_ID)) return;
  registerConfig();

  pi.on("tool_call", (event) => {
    const config = loadConfig();
    if (matchesExemptRule(config.exemptRules, event.toolName, event.input)) {
      delete (event.input as Record<string, unknown>).timeout;
      return;
    }
    if (!isToolCallEventType("bash", event)) return;
    if (config.maxTimeoutSeconds <= 0) return;
    event.input.timeout = resolveBashTimeoutSeconds(event.input.timeout, config.maxTimeoutSeconds);
  });
}
