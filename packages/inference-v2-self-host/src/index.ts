import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLogger } from "@htwang-contrib/common";
import { refreshCatalog } from "./catalog.ts";

const logger = createLogger("inference-v2-self-host");

export default async function (pi: ExtensionAPI) {
  logger.info("extension loaded");
  pi.registerProvider("inference-v2-self-host", {
    name: "Inference V2 (Self Host)",
    baseUrl: "https://inference-v2.twistoy.cn/api/v1",
    apiKey: "$INFERENCE_V2_TWISTOY_API_KEY",
    api: "openai-completions",
    authHeader: true,
    models: [],
    refreshModels: (context) => refreshCatalog(context),
  });
}
