import { throwIfApiError } from "./errors.ts";
import type { FetchResponse, FullProvider, SearchResponse, SearchResult } from "./types.ts";

const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1";

interface FirecrawlSearchResult {
  title?: string;
  url?: string;
  description?: string;
}

interface FirecrawlSearchResponse {
  success?: boolean;
  data?: FirecrawlSearchResult[];
  error?: string;
}

interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: {
      title?: string;
      description?: string;
      language?: string;
      statusCode?: number;
    };
  };
  error?: string;
}

function normalizeFirecrawlResults(results: FirecrawlSearchResult[]): SearchResult[] {
  return results.map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.description ?? "",
  }));
}

export class FirecrawlProvider implements FullProvider {
  readonly name = "firecrawl";
  readonly label = "Firecrawl";
  readonly envVar = "FIRECRAWL_API_KEY";

  constructor(private readonly apiKey: string) {}

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
    if (!this.apiKey) {
      throw new Error(`${this.envVar} is not set. Use /config to set the API key, or export the env var.`);
    }

    const res = await fetch(`${FIRECRAWL_API_URL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ query, limit: maxResults }),
      signal,
    });

    if (!res.ok) {
      throwIfApiError(this.name, res.status, await res.text());
    }

    const raw = (await res.json()) as FirecrawlSearchResponse;
    return { query, results: normalizeFirecrawlResults(raw.data ?? []) };
  }

  async fetch(url: string, _raw: boolean, signal?: AbortSignal): Promise<FetchResponse> {
    if (!this.apiKey) {
      throw new Error(`${this.envVar} is not set. Use /config to set the API key, or export the env var.`);
    }

    const res = await fetch(`${FIRECRAWL_API_URL}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ url, formats: ["markdown"] }),
      signal,
    });

    if (!res.ok) {
      throwIfApiError(this.name, res.status, await res.text());
    }

    const raw = (await res.json()) as FirecrawlScrapeResponse;
    if (!raw.success) {
      throw new Error(`${this.label} Fetch API error: ${raw.error ?? "scrape failed"}`);
    }
    if (!raw.data?.markdown) {
      throw new Error(`${this.label} Fetch API error: no content returned for ${url}`);
    }

    return {
      text: raw.data.markdown,
      title: raw.data.metadata?.title || undefined,
      contentType: "text/markdown",
    };
  }
}
