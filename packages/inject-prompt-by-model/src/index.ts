import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  isExtensionDisabled,
  isStaleCtxError,
  registerSystemPromptContribution,
  SYSTEM_PROMPT_CONTRIBUTION_PRIORITIES,
} from "@htwang-contrib/common";
import { type ModelLike, modelTarget, resolveModelPrompts } from "./resolve.ts";

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

  let sessionPrompt: string | null = null;
  let lastTarget: string | null = null;

  function applyModel(model: ModelLike | undefined, ctx: ExtensionContext): void {
    const target = model ? modelTarget(model) : null;
    if (target === lastTarget) return;
    lastTarget = target;
    sessionPrompt = null;
    if (target === null) return;
    const rules = resolveModelPrompts(target);
    if (rules.length === 0) return;
    sessionPrompt = rules.map((rule) => rule.prompt).join("\n\n");
    const names = rules.map((rule) => `"${rule.name}"`).join(", ");
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
    contribute() {
      return sessionPrompt;
    },
  });
}
