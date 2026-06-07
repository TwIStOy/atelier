import { BraveProvider } from "./brave.ts";
import { TavilyProvider } from "./tavily.ts";
import type { FullProvider, SearchProvider } from "./types.ts";

export interface ProviderCredentials {
  apiKey?: string;
}

export function createSearchProvider(
  name: string,
  creds: ProviderCredentials,
): SearchProvider | FullProvider {
  const apiKey = creds.apiKey ?? "";
  switch (name) {
    case "brave":
      return new BraveProvider(apiKey);
    case "tavily":
      return new TavilyProvider(apiKey);
    default:
      throw new Error(`Unknown search provider: "${name}"`);
  }
}
