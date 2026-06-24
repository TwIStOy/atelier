import { throwIfApiError } from "./errors.ts";
import type { SearchProvider, SearchResponse, SearchResult } from "./types.ts";

const BRAVE_SEARCH_API_URL = "https://api.search.brave.com/res/v1/web/search";

interface BraveRawResponse {
  web?: {
    results?: Array<{ title?: string; url?: string; description?: string }>;
  };
}

function normalizeBraveResults(raw: BraveRawResponse): SearchResult[] {
  return (raw.web?.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.description ?? "",
  }));
}

export class BraveProvider implements SearchProvider {
  readonly name = "brave";
  readonly label = "Brave";
  readonly envVar = "BRAVE_SEARCH_API_KEY";

  constructor(private readonly apiKey: string) {}

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
    if (!this.apiKey) {
      throw new Error(`${this.envVar} is not set. Use /config to set the API key, or export the env var.`);
    }

    const url = new URL(BRAVE_SEARCH_API_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(maxResults));

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": this.apiKey,
      },
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throwIfApiError(this.name, res.status, text);
    }

    const raw = (await res.json()) as BraveRawResponse;
    return { query, results: normalizeBraveResults(raw) };
  }
}
