import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { queryUsage } from "./quota.ts";
import { resetForegroundBeforeText } from "@htwang-contrib/common";

export default function (pi: ExtensionAPI) {
  pi.registerProvider("zai-coding-plan", {
    name: "Z.AI Coding Plan",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    apiKey: "ZAI_API_KEY",
    api: "openai-completions",
    authHeader: true,
    models: [
      {
        id: "glm-5.1",
        name: "GLM-5.1",
        reasoning: true,
        input: ["text"],
        cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 128000,
      },
      {
        id: "glm-5",
        name: "GLM-5",
        reasoning: true,
        input: ["text"],
        cost: { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 128000,
      },
      {
        id: "glm-5-turbo",
        name: "GLM-5-Turbo",
        reasoning: true,
        input: ["text"],
        cost: { input: 1.2, output: 4.0, cacheRead: 0.24, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 16384,
      },
      {
        id: "glm-4.7",
        name: "GLM-4.7",
        reasoning: false,
        input: ["text"],
        cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        id: "glm-4.5-air",
        name: "GLM-4.5-Air",
        reasoning: false,
        input: ["text"],
        cost: { input: 0.2, output: 1.1, cacheRead: 0.03, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
    ],
  });

  pi.registerCommand("zai-usage", {
    description: "Query Z.AI Coding Plan quota and usage",
    async handler(_args, ctx) {
      const apiKey = process.env.ZAI_API_KEY;
      if (!apiKey) {
        ctx.ui.notify("ZAI_API_KEY is not set", "error");
        return;
      }

      try {
        const usageInfo = await queryUsage(pi, apiKey);
        ctx.ui.notify(
          ctx.hasUI ? resetForegroundBeforeText(usageInfo) : usageInfo,
          "info",
        );
      } catch (e) {
        ctx.ui.notify(
          `Failed to query quota: ${e instanceof Error ? e.message : String(e)}`,
          "error",
        );
      }
    },
  });
}
