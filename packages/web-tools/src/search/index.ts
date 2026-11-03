import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { instantiateProviders } from "../config.ts";
import { describeError } from "../providers/errors.ts";
import type { SearchResponse, SearchResult } from "../providers/types.ts";

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

export interface SearchAttemptProvider {
  name: string;
  label: string;
  search: (query: string, maxResults: number, signal?: AbortSignal) => Promise<SearchResponse>;
}

export type SearchChainResult =
  | { ok: true; providerName: string; response: SearchResponse }
  | { ok: false; reason: string };

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function abortedError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}

export async function searchProviderChain(
  providers: ReadonlyArray<SearchAttemptProvider>,
  query: string,
  maxResults: number,
  signal: AbortSignal | undefined,
  onAttempt?: (provider: SearchAttemptProvider) => void,
): Promise<SearchChainResult> {
  const failures: string[] = [];
  for (const provider of providers) {
    throwIfAborted(signal);
    onAttempt?.(provider);
    const outcome = await attemptProvider(provider, query, maxResults, signal);
    if (outcome.response) return { ok: true, providerName: provider.name, response: outcome.response };
    failures.push(`${provider.label}: ${outcome.failure}`);
  }
  return { ok: false, reason: failures.length > 0 ? failures.join("; ") : "all providers failed" };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortedError(signal);
}

async function attemptProvider(
  provider: SearchAttemptProvider,
  query: string,
  maxResults: number,
  signal: AbortSignal | undefined,
): Promise<{ response?: SearchResponse; failure?: string }> {
  try {
    return { response: await provider.search(query, maxResults, signal) };
  } catch (err: unknown) {
    if (isAbortFailure(err, signal)) throw abortErrorFor(err, signal);
    return { failure: describeError(err) };
  }
}

function isAbortFailure(err: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || isAbortError(err);
}

function abortErrorFor(err: unknown, signal: AbortSignal | undefined): Error {
  if (err instanceof Error) return err;
  return signal ? abortedError(signal) : new Error(String(err));
}

function formatSearchResultsBody(response: { query: string; results: SearchResult[] }): string {
  let text = `**Search results for "${response.query}":**\n\n`;
  response.results.forEach((r, i) => {
    text += `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}\n\n`;
  });
  return text.trimEnd();
}

function searchSuccessResponse(query: string, providerName: string, response: SearchResponse) {
  return {
    content: [{ type: "text" as const, text: formatSearchResultsBody(response) }],
    details: {
      query,
      backend: providerName,
      resultCount: response.results.length,
      results: response.results,
    },
    structuredContent: { query, backend: providerName, results: response.results },
  };
}

function searchEmptyResponse(query: string, providerName: string) {
  return {
    content: [{ type: "text" as const, text: `No results found for "${query}".` }],
    details: {
      query,
      backend: providerName,
      resultCount: 0,
    },
    structuredContent: { query, backend: providerName, results: [] },
  };
}

function searchErrorResponse(query: string, reason: string) {
  return {
    content: [{ type: "text" as const, text: `Search error: ${reason}` }],
    details: { error: reason, query },
    isError: true,
  };
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

      const notify = (backend: string, label: string): void => {
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `Searching ${label} for: "${params.query}"...`,
            },
          ],
          details: {
            query: params.query,
            backend,
            resultCount: 0,
          },
        });
      };

      const outcome = await searchProviderChain(
        providers.map(({ name, provider }) => ({
          name,
          label: provider.label,
          search: (query, count, abort) => provider.search(query, count, abort),
        })),
        params.query,
        maxResults,
        signal,
        (provider) => notify(provider.name, provider.label),
      );

      if (!outcome.ok) return searchErrorResponse(params.query, outcome.reason);
      if (outcome.response.results.length === 0) return searchEmptyResponse(params.query, outcome.providerName);
      return searchSuccessResponse(params.query, outcome.providerName, outcome.response);
    },
  });
}
