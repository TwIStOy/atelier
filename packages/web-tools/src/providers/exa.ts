import { requestJson, requireContent, throwIfMissingApiKey } from "./http.ts";
import type { FetchResponse, FullProvider, SearchResponse, SearchResult } from "./types.ts";

const EXA_API_URL = "https://api.exa.ai/search";
const EXA_CONTENTS_API_URL = "https://api.exa.ai/contents";
const EXA_MAX_SNIPPET_CHARACTERS = 300;
const EXA_MAX_FETCH_CHARACTERS = 10000;

interface ExaRawResult {
  title?: string;
  url?: string;
  text?: string;
}

interface ExaRawResponse {
  results?: ExaRawResult[];
  error?: string;
}

function normalizeExaResults(results: ExaRawResult[]): SearchResult[] {
  return results.map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.text ?? "",
  }));
}

function exaFetchResponse(label: string, url: string, result: ExaRawResult | undefined): FetchResponse {
  return {
    text: requireContent(label, url, result?.text),
    title: result?.title || undefined,
    contentType: "text/plain",
  };
}

export class ExaProvider implements FullProvider {
  readonly name = "exa";
  readonly label = "Exa";
  readonly envVar = "EXA_API_KEY";

  constructor(private readonly apiKey: string) {}

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
    throwIfMissingApiKey(this.envVar, this.apiKey);

    const raw = await requestJson<ExaRawResponse>(
      this.name,
      EXA_API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
        },
        body: JSON.stringify({
          query,
          numResults: maxResults,
          contents: { text: { maxCharacters: EXA_MAX_SNIPPET_CHARACTERS } },
        }),
      },
      signal,
    );
    return { query, results: normalizeExaResults(raw.results ?? []) };
  }

  async fetch(url: string, _raw: boolean, signal?: AbortSignal): Promise<FetchResponse> {
    throwIfMissingApiKey(this.envVar, this.apiKey);

    const data = await requestJson<ExaRawResponse>(
      this.name,
      EXA_CONTENTS_API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
        },
        body: JSON.stringify({
          ids: [url],
          text: { maxCharacters: EXA_MAX_FETCH_CHARACTERS },
        }),
      },
      signal,
    );
    return exaFetchResponse(this.label, url, data.results?.[0]);
  }
}
