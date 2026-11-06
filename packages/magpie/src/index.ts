import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerChildExtensionFactory } from "@htwang-contrib/common/agents/child-extensions";
import { isExtensionDisabled } from "@htwang-contrib/common/extension-disable";
import { createLogger } from "@htwang-contrib/common/log";
import { API_KEY, refreshCatalog } from "./catalog.ts";
import { COMMAND_NAME, handleRefreshCommand, PROVIDER_ID } from "./command.ts";

const logger = createLogger("magpie");

const SESSION_HEADER = "x-magpie-session";

export default async function magpie(pi: ExtensionAPI) {
  if (isExtensionDisabled("magpie")) return;
  registerChildExtensionFactory("magpie", magpie);
  logger.info("extension loaded");
  pi.registerProvider(PROVIDER_ID, {
    name: "Magpie",
    baseUrl: "http://100.65.0.3:3425/v1",
    apiKey: API_KEY,
    api: "openai-completions",
    authHeader: true,
    models: [],
    refreshModels: (context) => refreshCatalog(context),
  });

  pi.registerCommand(COMMAND_NAME, {
    description: "Force-refresh the magpie model catalog",
    handler: handleRefreshCommand,
  });

  pi.on("before_provider_headers", (event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_ID) return;
    event.headers.Authorization = `Bearer ${API_KEY}`;
    const sessionId = ctx.sessionManager.getSessionId();
    if (sessionId) event.headers[SESSION_HEADER] = sessionId;
  });
}
