import { requestJson, requireContent, throwIfMissingApiKey } from "./http.ts";
import type { FetchResponse, FullProvider, SearchResponse, SearchResult } from "./types.ts";

const YOUCOM_SEARCH_URL = "https://ydc-index.io/v1/search";
const YOUCOM_CONTENTS_URL = "https://ydc-index.io/v1/contents";

interface YouComWebResult {
  url?: string;
  title?: string;
  description?: string;
  snippets?: string[];
}

interface YouComSearchResponse {
  results?: { web?: YouComWebResult[] };
}

interface YouComContentsResponseItem {
  url: string;
  title?: string;
  markdown?: string | null;
}

function youcomSnippet(r: YouComWebResult): string {
  return r.snippets?.[0] ?? r.description ?? "";
}

function normalizeYouComResults(results: YouComWebResult[]): SearchResult[] {
  return results.map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: youcomSnippet(r),
  }));
}

export class YouComProvider implements FullProvider {
  readonly name = "youcom";
  readonly label = "You.com";
  readonly envVar = "YOUCOM_API_KEY";

  constructor(private readonly apiKey: string) {}

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
    throwIfMissingApiKey(this.envVar, this.apiKey);

    const raw = await requestJson<YouComSearchResponse>(
      this.name,
      YOUCOM_SEARCH_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.apiKey,
        },
        body: JSON.stringify({ query, count: maxResults }),
      },
      signal,
    );
    return {
      query,
      results: normalizeYouComResults(raw.results?.web ?? []),
    };
  }

  async fetch(url: string, _raw: boolean, signal?: AbortSignal): Promise<FetchResponse> {
    throwIfMissingApiKey(this.envVar, this.apiKey);

    const raw = await requestJson<YouComContentsResponseItem[]>(
      this.name,
      YOUCOM_CONTENTS_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.apiKey,
        },
        body: JSON.stringify({ urls: [url], formats: ["markdown"] }),
      },
      signal,
    );
    const item = raw[0];
    const text = requireContent(this.label, url, item?.markdown);

    return {
      text,
      title: item?.title || undefined,
      contentType: "text/markdown",
    };
  }
}
