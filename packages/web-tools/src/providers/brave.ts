import { requestJson, throwIfMissingApiKey } from "./http.ts";
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
    throwIfMissingApiKey(this.envVar, this.apiKey);

    const url = new URL(BRAVE_SEARCH_API_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(maxResults));

    const raw = await requestJson<BraveRawResponse>(
      this.name,
      url.toString(),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": this.apiKey,
        },
      },
      signal,
    );
    return { query, results: normalizeBraveResults(raw) };
  }
}
