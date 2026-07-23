import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLogger } from "@htwang-contrib/common";
import { refreshCatalog } from "./catalog.ts";

const logger = createLogger("inference-v2-self-host");

const PROVIDER_ID = "inference-v2-self-host";
const SESSION_AFFINITY_HEADER = "x-lite-session-id";

export default async function (pi: ExtensionAPI) {
  logger.info("extension loaded");
  pi.registerProvider(PROVIDER_ID, {
    name: "Inference V2 (Self Host)",
    baseUrl: "https://inference-v2.twistoy.cn/api/v1",
    apiKey: "$INFERENCE_V2_TWISTOY_API_KEY",
    api: "openai-completions",
    authHeader: true,
    models: [],
    refreshModels: (context) => refreshCatalog(context),
  });

  pi.on("before_provider_headers", (event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_ID) return;
    const sessionId = ctx.sessionManager.getSessionId();
    if (sessionId) event.headers[SESSION_AFFINITY_HEADER] = sessionId;
  });
}
