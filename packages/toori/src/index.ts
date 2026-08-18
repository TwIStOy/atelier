import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLogger, isExtensionDisabled } from "@htwang-contrib/common";
import { refreshCatalog } from "./catalog.ts";
import { COMMAND_NAME, ENV_VAR, handleRefreshCommand, PROVIDER_ID } from "./command.ts";

const logger = createLogger("toori");

const SESSION_AFFINITY_HEADER = "x-lite-session-id";

export default async function (pi: ExtensionAPI) {
  if (isExtensionDisabled("toori")) return;
  logger.info("extension loaded");
  pi.registerProvider(PROVIDER_ID, {
    name: "Toori",
    baseUrl: "https://toori.twistoy.cn/api/v1",
    apiKey: `$${ENV_VAR}`,
    api: "openai-completions",
    authHeader: true,
    models: [],
    refreshModels: (context) => refreshCatalog(context),
  });

  pi.registerCommand(COMMAND_NAME, {
    description: "Force-refresh the toori model catalog",
    handler: handleRefreshCommand,
  });

  pi.on("before_provider_headers", (event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_ID) return;
    const sessionId = ctx.sessionManager.getSessionId();
    if (sessionId) event.headers[SESSION_AFFINITY_HEADER] = sessionId;
  });
}
