import { BraveProvider } from "./brave.ts";
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
      throw new Error(`Provider "${name}" not yet implemented`);
    default:
      throw new Error(`Unknown search provider: "${name}"`);
  }
}
