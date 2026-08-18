import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  isExtensionDisabled,
  isStaleCtxError,
  registerSystemPromptContribution,
  SYSTEM_PROMPT_CONTRIBUTION_PRIORITIES,
} from "@htwang-contrib/common";
import {
  applyModelPromptRules,
  type ModelLike,
  type ModelPromptRule,
  modelTarget,
  resolveModelPrompts,
} from "./resolve.ts";

export const EXTENSION_ID = "inject-prompt-by-model";

function notifySafely(ctx: ExtensionContext, message: string): void {
  try {
    ctx.ui.notify(message, "info");
  } catch (err) {
    if (!isStaleCtxError(err)) throw err;
  }
}

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled(EXTENSION_ID)) return;

  let matchedRules: ModelPromptRule[] = [];
  let lastTarget: string | null = null;

  function applyModel(model: ModelLike | undefined, ctx: ExtensionContext): void {
    const target = model ? modelTarget(model) : null;
    if (target === lastTarget) return;
    lastTarget = target;
    matchedRules = target === null ? [] : resolveModelPrompts(target);
    if (matchedRules.length === 0) return;
    const names = matchedRules.map((rule) => `"${rule.name}"`).join(", ");
    notifySafely(ctx, `inject-prompt-by-model: applied ${names} for ${target}`);
  }

  pi.on("session_start", (_event, ctx) => {
    lastTarget = null;
    applyModel(ctx.model, ctx);
  });

  pi.on("model_select", (event, ctx) => {
    applyModel(event.model, ctx);
  });

  registerSystemPromptContribution(pi, {
    id: EXTENSION_ID,
    priority: SYSTEM_PROMPT_CONTRIBUTION_PRIORITIES["inject-prompt-by-model"],
    mode: "replace",
    contribute(event) {
      return applyModelPromptRules(event.systemPrompt, matchedRules);
    },
  });
}
