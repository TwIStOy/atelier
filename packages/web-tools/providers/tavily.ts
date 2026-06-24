import { throwIfApiError } from "./errors.ts";
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
    if (!this.apiKey) {
      throw new Error(`${this.envVar} is not set. Use /config to set the API key, or export the env var.`);
    }

    const res = await fetch(TAVILY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: maxResults,
      }),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throwIfApiError(this.name, res.status, text);
    }

    const raw = (await res.json()) as TavilyRawResponse;
    return { query, results: normalizeTavilyResults(raw.results ?? []) };
  }

  async fetch(url: string, _raw: boolean, signal?: AbortSignal): Promise<FetchResponse> {
    if (!this.apiKey) {
      throw new Error(`${this.envVar} is not set. Use /config to set the API key, or export the env var.`);
    }

    const res = await fetch(TAVILY_EXTRACT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ urls: [url] }),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throwIfApiError(this.name, res.status, text);
    }

    const data = (await res.json()) as TavilyExtractResponse;

    if (data.failed_results && data.failed_results.length > 0) {
      const failed = data.failed_results[0];
      throw new Error(
        `${this.label} Fetch API error: extraction failed for ${failed.url ?? url}: ${failed.error ?? "unknown error"}`,
      );
    }

    const result = data.results?.[0];
    if (!result?.raw_content) {
      throw new Error(`${this.label} Fetch API error: no content returned for ${url}`);
    }

    return {
      text: result.raw_content,
      contentType: "text/plain",
    };
  }
}
