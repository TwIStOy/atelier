export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

export interface FetchResponse {
  text: string;
  title?: string;
  contentType?: string;
  contentLength?: number;
}

export interface SearchProvider {
  readonly name: string;
  readonly label: string;
  readonly envVar: string;
  search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse>;
}

export interface FetchProvider {
  readonly name: string;
  readonly label: string;
  readonly envVar: string;
  fetch(url: string, raw: boolean, signal?: AbortSignal): Promise<FetchResponse>;
}

export type FullProvider = SearchProvider & FetchProvider;

export type ProviderRole = "search" | "fetch";

export interface ProviderMeta {
  name: string;
  label: string;
  envVar?: string;
  roles: ReadonlyArray<ProviderRole>;
}
