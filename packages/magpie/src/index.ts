import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerChildExtensionFactory } from "@htwang-contrib/common/agents/child-extensions";
import { isExtensionDisabled } from "@htwang-contrib/common/extension-disable";
import { createLogger } from "@htwang-contrib/common/log";
import { classifierModelConfigs, refreshCatalog } from "./catalog.ts";
import { MAGPIE_SYSTEM_ONE_API, magpieSystemOneClassifier } from "./classifier.ts";
import { COMMAND_NAME, handleRefreshCommand, PROVIDER_ID } from "./command.ts";
import { loadMagpieConfig, magpieClassifierIds, magpieEndpoint, registerMagpieConfigItems } from "./config.ts";

const logger = createLogger("magpie");

const SESSION_HEADER = "x-magpie-session";

export default async function magpie(pi: ExtensionAPI) {
  if (isExtensionDisabled("magpie")) return;
  registerChildExtensionFactory("magpie", magpie);
  logger.info("extension loaded");

  const registerProvider = () => {
    const endpoint = magpieEndpoint();
    const config = loadMagpieConfig();
    pi.registerProvider(PROVIDER_ID, {
      name: "Magpie",
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      api: "openai-completions",
      authHeader: true,
      models: classifierModelConfigs(endpoint, magpieClassifierIds(config)),
      classifiers: { [MAGPIE_SYSTEM_ONE_API]: magpieSystemOneClassifier },
      refreshModels: (context) => refreshCatalog(context),
    });
  };

  registerMagpieConfigItems();
  registerProvider();

  pi.registerCommand(COMMAND_NAME, {
    description: "Force-refresh the magpie model catalog",
    handler: handleRefreshCommand,
  });

  pi.on("session_start", () => {
    registerMagpieConfigItems();
    registerProvider();
  });

  pi.on("before_provider_headers", (event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_ID) return;
    event.headers.Authorization = `Bearer ${loadMagpieConfig().apiKey}`;
    const sessionId = ctx.sessionManager.getSessionId();
    if (sessionId) event.headers[SESSION_HEADER] = sessionId;
  });
}
