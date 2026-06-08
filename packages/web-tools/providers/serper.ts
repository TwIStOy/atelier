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

function normalizeSerperResults(
  results: SerperOrganicResult[],
): SearchResult[] {
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

    const res = await fetch(SERPER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": this.apiKey,
      },
      body: JSON.stringify({ q: query, num: maxResults }),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `${this.label} Search API error (${res.status}): ${text}`,
      );
    }

    const raw = (await res.json()) as SerperRawResponse;
    return { query, results: normalizeSerperResults(raw.organic ?? []) };
  }
}
