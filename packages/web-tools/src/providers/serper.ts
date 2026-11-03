import { requestJson, throwIfMissingApiKey } from "./http.ts";
import type { SearchProvider, SearchResponse, SearchResult } from "./types.ts";

const SERPER_API_URL = "https://google.serper.dev/search";

interface SerperOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
}

interface SerperRawResponse {
  organic?: SerperOrganicResult[];
  message?: string;
}

function normalizeSerperResults(results: SerperOrganicResult[]): SearchResult[] {
  return results.map((r) => ({
    title: r.title ?? "",
    url: r.link ?? "",
    snippet: r.snippet ?? "",
  }));
}

export class SerperProvider implements SearchProvider {
  readonly name = "serper";
  readonly label = "Serper";
  readonly envVar = "SERPER_API_KEY";

  constructor(private readonly apiKey: string) {}

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
    throwIfMissingApiKey(this.envVar, this.apiKey);

    const raw = await requestJson<SerperRawResponse>(
      this.name,
      SERPER_API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": this.apiKey,
        },
        body: JSON.stringify({ q: query, num: maxResults }),
      },
      signal,
    );
    return { query, results: normalizeSerperResults(raw.organic ?? []) };
  }
}
