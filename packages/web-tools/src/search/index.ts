import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { instantiateProviders, isRateLimitError } from "../config.ts";
import type { SearchResult } from "../providers/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const searchToolDescription = readFileSync(join(__dirname, "prompt.txt"), "utf-8").trim();

const MIN_SEARCH_RESULTS = 1;
const MAX_SEARCH_RESULTS = 10;
const DEFAULT_SEARCH_RESULTS = 5;

const searchOutputSchema = Type.Object({
  query: Type.String(),
  backend: Type.String(),
  results: Type.Array(
    Type.Object({
      title: Type.String(),
      url: Type.String(),
      snippet: Type.String(),
    }),
  ),
});

function clampSearchResultCount(requested: number | undefined): number {
  const value = requested ?? DEFAULT_SEARCH_RESULTS;
  return Math.min(Math.max(value, MIN_SEARCH_RESULTS), MAX_SEARCH_RESULTS);
}

function formatSearchResultsBody(response: { query: string; results: SearchResult[] }): string {
  let text = `**Search results for "${response.query}":**\n\n`;
  response.results.forEach((r, i) => {
    text += `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}\n\n`;
  });
  return text.trimEnd();
}

const searchParams = Type.Object({
  query: Type.String({
    description: "The search query. Be specific and use natural language.",
  }),
  max_results: Type.Optional(
    Type.Number({
      description: `Maximum number of results to return (${MIN_SEARCH_RESULTS}-${MAX_SEARCH_RESULTS}). Default: ${DEFAULT_SEARCH_RESULTS}.`,
      default: DEFAULT_SEARCH_RESULTS,
      minimum: MIN_SEARCH_RESULTS,
      maximum: MAX_SEARCH_RESULTS,
    }),
  ),
});

export function registerWebSearchTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: searchToolDescription,
    promptSnippet: "Search the web for up-to-date information",
    parameters: searchParams,
    annotations: { readOnlyHint: true, openWorldHint: true },
    outputSchema: searchOutputSchema,

    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const maxResults = clampSearchResultCount(params.max_results);
      const { providers } = instantiateProviders();

      let lastError: Error | undefined;
      for (const { name: providerName, provider } of providers) {
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `Searching ${provider.label} for: "${params.query}"...`,
            },
          ],
          details: {
            query: params.query,
            backend: providerName,
            resultCount: 0,
          },
        });

        try {
          const response = await provider.search(params.query, maxResults, signal);

          if (response.results.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `No results found for "${params.query}".`,
                },
              ],
              details: {
                query: params.query,
                backend: providerName,
                resultCount: 0,
              },
              structuredContent: { query: params.query, backend: providerName, results: [] },
            };
          }

          return {
            content: [{ type: "text", text: formatSearchResultsBody(response) }],
            details: {
              query: params.query,
              backend: providerName,
              resultCount: response.results.length,
              results: response.results,
            },
            structuredContent: { query: params.query, backend: providerName, results: response.results },
          };
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (!isRateLimitError(err)) break;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Search error: ${lastError?.message ?? "all providers failed"}`,
          },
        ],
        details: { error: lastError?.message, query: params.query },
        isError: true,
      };
    },
  });
}
