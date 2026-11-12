import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled } from "@htwang-contrib/common/extension-disable";
import { registerTuiCommands } from "@htwang-contrib/common/tui-commands";
import { registerRexTitleConfigItems } from "./config.ts";
import { createTitleUpdater } from "./title-updater.ts";

export { branchUserMessages, buildTitlePrompt, parseTitle } from "./title-updater.ts";

export default function rexTitleExtension(pi: ExtensionAPI): void {
  if (isExtensionDisabled("rex-title")) return;

  const updater = createTitleUpdater(pi);
  let runHasUserMessage = false;

  pi.on("before_agent_start", (event) => {
    runHasUserMessage = event.messageType === "user";
  });
  pi.on("agent_end", (event, ctx) => {
    const shouldRefresh = runHasUserMessage || event.messages.some((message) => message.role === "user");
    runHasUserMessage = false;
    if (ctx.mode === "tui" && shouldRefresh) updater.refresh(ctx);
  });
  pi.on("session_start", (_event, ctx) => {
    runHasUserMessage = false;
    updater.cancel();
    registerRexTitleConfigItems(ctx.modelRegistry);
  });
  pi.on("session_shutdown", () => updater.cancel());

  registerTuiCommands(pi, (api) => {
    api.registerCommand("rex-title", {
      description: "Summarize this session and rename its Rex pane",
      handler: async (_args, ctx) => {
        await ctx.waitForIdle();
        const result = await updater.run(ctx);
        if (result.ok) {
          ctx.ui.notify(`Rex pane renamed to "${result.title}".`, "info");
        } else if (result.timedOut) {
          ctx.ui.notify(result.error, "warning");
        } else if (!result.cancelled) {
          ctx.ui.notify(`Could not update Rex title: ${result.error}`, "error");
        }
      },
    });
  });
}
