import type { ExtensionAPI, ExtensionContext, SessionStartEvent } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled } from "@htwang-contrib/common";
import { loadRecapConfig, registerRecapConfigItems, setCachedModels } from "./config.ts";
import { IdleListener } from "./idle.ts";
import { createRecapManager, type RecapManager } from "./manager.ts";

export type { IdleState } from "./idle.ts";
export { IdleListener } from "./idle.ts";
export { buildRecapPrompt, parseRecap } from "./manager.ts";

export default function recapExtension(pi: ExtensionAPI): void {
  if (isExtensionDisabled("recap")) return;

  registerRecapConfigItems();

  let idleListener: IdleListener<ExtensionContext> | undefined;
  let recapManager: RecapManager | undefined;

  pi.registerCommand("recap", {
    description: "Generate a short recap of the current session",
    async handler(_args, ctx) {
      if (!loadRecapConfig().enabled) {
        ctx.ui.notify("Recap is disabled in /config", "warning");
        return;
      }
      recapManager = recapManager ?? createRecapManager(pi);
      await recapManager?.run(ctx, { force: true });
    },
  });

  pi.on("session_start", (event, ctx) => {
    if (ctx.mode !== "tui") return;

    cacheSessionModels(ctx);
    startIdleListener(event.reason, ctx);
  });

  function cacheSessionModels(ctx: ExtensionContext): void {
    setCachedModels(
      ctx.modelRegistry.getAvailable().map((m) => ({
        label: `${m.provider}/${m.id}`,
        value: `${m.provider}/${m.id}`,
      })),
    );
  }

  function startIdleListener(reason: SessionStartEvent["reason"], ctx: ExtensionContext): void {
    recapManager = createRecapManager(pi);
    if (!recapManager) return;

    const config = loadRecapConfig();
    idleListener = new IdleListener((c) => `idle:${c.isIdle()};editor:${c.ui.getEditorText()}`, {
      idleMs: config.idleSeconds * 1000,
    });
    idleListener.on("enter", (c) => recapManager?.run(c));
    idleListener.on("wake", (c) => recapManager?.clear(c));

    if (reason === "resume" || reason === "fork") {
      idleListener.watch(ctx);
    }
  }

  pi.on("input", (_event, ctx) => idleListener?.wake(ctx));
  pi.on("user_bash", (_event, ctx) => idleListener?.wake(ctx));
  pi.on("agent_start", (_event, ctx) => idleListener?.wake(ctx));
  pi.on("session_before_compact", (_event, ctx) => idleListener?.wake(ctx));
  pi.on("session_before_tree", (_event, ctx) => idleListener?.wake(ctx));

  pi.on("agent_settled", (_event, ctx) => idleListener?.watch(ctx));
  pi.on("session_compact", (_event, ctx) => idleListener?.watch(ctx));
  pi.on("session_tree", (_event, ctx) => idleListener?.watch(ctx));

  pi.on("session_shutdown", (_event, ctx) => {
    recapManager?.clear(ctx);
    recapManager = undefined;
    idleListener?.dispose();
    idleListener = undefined;
  });
}
