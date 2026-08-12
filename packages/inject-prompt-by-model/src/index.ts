import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled } from "@htwang-contrib/common";
import { modelTarget, resolveModelPrompt } from "./rules.ts";

export const EXTENSION_ID = "inject-prompt-by-model";

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled(EXTENSION_ID)) return;

  pi.on("before_agent_start", (event, ctx) => {
    const model = ctx.model;
    if (!model) return;
    const rule = resolveModelPrompt(modelTarget(model));
    if (!rule) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${rule.prompt}` };
  });
}
