import { requestJson, requireContent, throwIfMissingApiKey } from "./http.ts";
import type { FetchResponse, FullProvider, SearchResponse, SearchResult } from "./types.ts";

const TAVILY_API_URL = "https://api.tavily.com/search";
const TAVILY_EXTRACT_API_URL = "https://api.tavily.com/extract";

interface TavilyRawResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyRawResponse {
  results?: TavilyRawResult[];
  detail?: string;
  error?: string;
}

interface TavilyExtractResult {
  url?: string;
  raw_content?: string;
}

interface TavilyExtractResponse {
  results?: TavilyExtractResult[];
  failed_results?: Array<{ url?: string; error?: string }>;
}

function tavilyExtractionErrorMessage(label: string, url: string, failed: { url?: string; error?: string }): string {
  return `${label} Fetch API error: extraction failed for ${failed.url ?? url}: ${failed.error ?? "unknown error"}`;
}

function throwIfTavilyExtractionFailed(label: string, url: string, data: TavilyExtractResponse): void {
  const failed = data.failed_results?.[0];
  if (failed) {
    throw new Error(tavilyExtractionErrorMessage(label, url, failed));
  }
}

function normalizeTavilyResults(results: TavilyRawResult[]): SearchResult[] {
  return results.map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }));
}

export class TavilyProvider implements FullProvider {
  readonly name = "tavily";
  readonly label = "Tavily";
  readonly envVar = "TAVILY_API_KEY";

  constructor(private readonly apiKey: string) {}

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
    throwIfMissingApiKey(this.envVar, this.apiKey);

    const raw = await requestJson<TavilyRawResponse>(
      this.name,
      TAVILY_API_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          max_results: maxResults,
        }),
      },
      signal,
    );
    return { query, results: normalizeTavilyResults(raw.results ?? []) };
  }

  async fetch(url: string, _raw: boolean, signal?: AbortSignal): Promise<FetchResponse> {
    throwIfMissingApiKey(this.envVar, this.apiKey);

    const data = await requestJson<TavilyExtractResponse>(
      this.name,
      TAVILY_EXTRACT_API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ urls: [url] }),
      },
      signal,
    );

    throwIfTavilyExtractionFailed(this.label, url, data);

    const result = data.results?.[0];
    const text = requireContent(this.label, url, result?.raw_content);

    return {
      text,
      contentType: "text/plain",
    };
  }
}
