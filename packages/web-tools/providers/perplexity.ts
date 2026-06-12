import type { SearchProvider, SearchResponse, SearchResult } from "./types.ts";
import { throwIfApiError } from "./errors.ts";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/search";

interface PerplexityRawResult {
  title?: string;
  url?: string;
  snippet?: string;
  date?: string | null;
  last_updated?: string | null;
}

interface PerplexityRawResponse {
  results?: PerplexityRawResult[];
  id?: string;
  server_time?: string | null;
}

function normalizePerplexityResults(
  results: PerplexityRawResult[],
): SearchResult[] {
  return results.map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.snippet ?? "",
  }));
}

export class PerplexityProvider implements SearchProvider {
  readonly name = "perplexity";
  readonly label = "Perplexity";
  readonly envVar = "PERPLEXITY_API_KEY";

  constructor(private readonly apiKey: string) {}

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResponse> {
    if (!this.apiKey) {
      throw new Error(
        `${this.envVar} is not set. Use /config to set the API key, or export the env var.`,
      );
    }

    const res = await fetch(PERPLEXITY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ query, max_results: maxResults }),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throwIfApiError(this.name, res.status, text);
    }

    const raw = (await res.json()) as PerplexityRawResponse;
    return { query, results: normalizePerplexityResults(raw.results ?? []) };
  }
}
