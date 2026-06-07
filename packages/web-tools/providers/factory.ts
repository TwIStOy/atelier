import type { FullProvider, SearchProvider } from "./types.ts";

export interface ProviderCredentials {
  apiKey?: string;
}

export function createSearchProvider(
  name: string,
  _creds: ProviderCredentials,
): SearchProvider | FullProvider {
  switch (name) {
    case "brave":
    case "tavily":
      throw new Error(`Provider "${name}" not yet implemented`);
    default:
      throw new Error(`Unknown search provider: "${name}"`);
  }
}
