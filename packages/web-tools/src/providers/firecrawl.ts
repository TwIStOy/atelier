import { requestJson, requireContent, throwIfMissingApiKey } from "./http.ts";
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
    throwIfMissingApiKey(this.envVar, this.apiKey);

    const raw = await requestJson<FirecrawlSearchResponse>(
      this.name,
      `${FIRECRAWL_API_URL}/search`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ query, limit: maxResults }),
      },
      signal,
    );
    return { query, results: normalizeFirecrawlResults(raw.data ?? []) };
  }

  async fetch(url: string, _raw: boolean, signal?: AbortSignal): Promise<FetchResponse> {
    throwIfMissingApiKey(this.envVar, this.apiKey);

    const raw = await requestJson<FirecrawlScrapeResponse>(
      this.name,
      `${FIRECRAWL_API_URL}/scrape`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ url, formats: ["markdown"] }),
      },
      signal,
    );
    if (!raw.success) {
      throw new Error(`${this.label} Fetch API error: ${raw.error ?? "scrape failed"}`);
    }
    const text = requireContent(this.label, url, raw.data?.markdown);

    return {
      text,
      title: raw.data?.metadata?.title || undefined,
      contentType: "text/markdown",
    };
  }
}
