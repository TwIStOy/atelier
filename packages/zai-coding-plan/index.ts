import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { queryUsage } from "./quota.ts";
import { zaiWebSearch, zaiWebRead } from "./search.ts";
import {
  ZAI_CODING_PLAN_EVENTS,
  resetForegroundBeforeText,
} from "@htwang-contrib/common";

const PROVIDER_ID = "zai-coding-plan";

function maybeRefreshUsage(pi: ExtensionAPI, ctx: ExtensionContext) {
  const model = ctx.model;
  if (!model || model.provider !== PROVIDER_ID) return;
  pi.events.emit(ZAI_CODING_PLAN_EVENTS.REQUEST_USAGE, {});
}

export default function (pi: ExtensionAPI) {
  pi.registerProvider(PROVIDER_ID, {
    name: "Z.AI Coding Plan",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    apiKey: "$ZAI_API_KEY",
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

  pi.events.on(ZAI_CODING_PLAN_EVENTS.REQUEST_USAGE, async () => {
    const apiKey = process.env.ZAI_API_KEY;
    if (!apiKey) return;
    await queryUsage(pi, apiKey).catch(() => {});
  });

  pi.on("session_start", (_event, ctx) => {
    maybeRefreshUsage(pi, ctx);
    if (process.env.ZAI_API_KEY) {
      pi.setActiveTools([
        ...pi.getActiveTools(),
        "web_search_prime",
        "web_read_prime",
      ]);
    }
  });
  pi.on("turn_end", (_event, ctx) => maybeRefreshUsage(pi, ctx));
  pi.on("model_select", (event, ctx) => {
    if (event.model.provider === PROVIDER_ID) {
      maybeRefreshUsage(pi, ctx);
    }
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

  pi.registerTool({
    name: "web_search_prime",
    label: "Web Search Prime",
    description:
      "Search the web using Z.AI Web Search Prime (MCP). Returns ranked results with titles, URLs, and snippets. Requires ZAI_API_KEY.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }),
    async execute(_id, params, signal, _onUpdate, _ctx) {
      const apiKey = process.env.ZAI_API_KEY;
      if (!apiKey) {
        return {
          content: [
            {
              type: "text" as const,
              text: "ZAI_API_KEY is not set. Cannot perform web search.",
            },
          ],
          details: { error: "no_api_key" },
          isError: true,
        };
      }

      try {
        const { results, raw } = await zaiWebSearch(
          params.query,
          apiKey,
          signal,
        );
        return {
          content: [{ type: "text" as const, text: raw }],
          details: { query: params.query, resultCount: results.length },
        };
      } catch (err: unknown) {
        if (signal?.aborted) {
          return {
            content: [{ type: "text" as const, text: "Search cancelled." }],
            details: { error: "cancelled" },
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Search error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: { error: err instanceof Error ? err.message : String(err) },
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "web_read_prime",
    label: "Web Read Prime",
    description:
      "Read and extract the full content of a web page using Z.AI Web Reader (MCP). Returns page title, main content, metadata, and links. Requires ZAI_API_KEY.",
    parameters: Type.Object({
      url: Type.String({ description: "URL of the web page to read" }),
    }),
    async execute(_id, params, signal, _onUpdate, _ctx) {
      const apiKey = process.env.ZAI_API_KEY;
      if (!apiKey) {
        return {
          content: [
            {
              type: "text" as const,
              text: "ZAI_API_KEY is not set. Cannot read web page.",
            },
          ],
          details: { error: "no_api_key" },
          isError: true,
        };
      }

      try {
        const { raw, content } = await zaiWebRead(params.url, apiKey, signal);
        const lines = content.split("\n").length;
        return {
          content: [{ type: "text" as const, text: raw }],
          details: { url: params.url, lineCount: lines },
        };
      } catch (err: unknown) {
        if (signal?.aborted) {
          return {
            content: [{ type: "text" as const, text: "Read cancelled." }],
            details: { error: "cancelled" },
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Read error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: { error: err instanceof Error ? err.message : String(err) },
          isError: true,
        };
      }
    },
  });
}
