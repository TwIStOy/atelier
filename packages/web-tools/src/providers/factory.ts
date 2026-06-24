import { BraveProvider } from "./brave.ts";
import { ExaProvider } from "./exa.ts";
import { FirecrawlProvider } from "./firecrawl.ts";
import { JinaProvider } from "./jina.ts";
import { PerplexityProvider } from "./perplexity.ts";
import { SerperProvider } from "./serper.ts";
import { TavilyProvider } from "./tavily.ts";
import type { FullProvider, SearchProvider } from "./types.ts";
import { YouComProvider } from "./youcom.ts";
import { ZaiProvider } from "./zai.ts";

export interface ProviderCredentials {
  apiKey?: string;
}

export function createSearchProvider(name: string, creds: ProviderCredentials): SearchProvider | FullProvider {
  const apiKey = creds.apiKey ?? "";
  switch (name) {
    case "brave":
      return new BraveProvider(apiKey);
    case "tavily":
      return new TavilyProvider(apiKey);
    case "serper":
      return new SerperProvider(apiKey);
    case "perplexity":
      return new PerplexityProvider(apiKey);
    case "exa":
      return new ExaProvider(apiKey);
    case "youcom":
      return new YouComProvider(apiKey);
    case "jina":
      return new JinaProvider(apiKey);
    case "firecrawl":
      return new FirecrawlProvider(apiKey);
    case "zai":
      return new ZaiProvider(apiKey);
    default:
      throw new Error(`Unknown search provider: "${name}"`);
  }
}
