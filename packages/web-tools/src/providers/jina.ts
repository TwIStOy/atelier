import { throwIfApiError } from "./errors.ts";
import { requestJson, requireContent, throwIfMissingApiKey } from "./http.ts";
import type { FetchResponse, FullProvider, SearchResponse, SearchResult } from "./types.ts";

const JINA_SEARCH_API_URL = "https://s.jina.ai/";
const JINA_READER_API_URL = "https://r.jina.ai/";

interface JinaSearchResult {
  title?: string;
  url?: string;
  description?: string;
}

interface JinaSearchResponse {
  code?: number;
  status?: number;
  data?: {
    query?: string;
    total?: number;
    results?: JinaSearchResult[];
  };
}

function normalizeJinaResults(results: JinaSearchResult[]): SearchResult[] {
  return results.map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.description ?? "",
  }));
}

export class JinaProvider implements FullProvider {
  readonly name = "jina";
  readonly label = "Jina";
  readonly envVar = "JINA_API_KEY";

  constructor(private readonly apiKey: string) {}

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
    throwIfMissingApiKey(this.envVar, this.apiKey);

    const url = new URL(`${JINA_SEARCH_API_URL}${encodeURIComponent(query)}`);
    url.searchParams.set("num", String(maxResults));

    const raw = await requestJson<JinaSearchResponse>(
      this.name,
      url.toString(),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
      },
      signal,
    );
    const results = normalizeJinaResults(raw.data?.results ?? []).slice(0, maxResults);
    return { query, results };
  }

  async fetch(url: string, _raw: boolean, signal?: AbortSignal): Promise<FetchResponse> {
    throwIfMissingApiKey(this.envVar, this.apiKey);

    const res = await fetch(`${JINA_READER_API_URL}${url}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal,
    });

    if (!res.ok) {
      throwIfApiError(this.name, res.status, await res.text());
    }

    const text = await res.text();
    requireContent(this.label, url, text.trim());
    return { text, contentType: "text/markdown" };
  }
}
