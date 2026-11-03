import { AnySearchProvider } from "./anysearch.ts";
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

type ProviderFactory = (apiKey: string) => SearchProvider | FullProvider;

const PROVIDER_FACTORIES = new Map<string, ProviderFactory>([
  ["brave", (apiKey) => new BraveProvider(apiKey)],
  ["tavily", (apiKey) => new TavilyProvider(apiKey)],
  ["serper", (apiKey) => new SerperProvider(apiKey)],
  ["perplexity", (apiKey) => new PerplexityProvider(apiKey)],
  ["exa", (apiKey) => new ExaProvider(apiKey)],
  ["youcom", (apiKey) => new YouComProvider(apiKey)],
  ["jina", (apiKey) => new JinaProvider(apiKey)],
  ["firecrawl", (apiKey) => new FirecrawlProvider(apiKey)],
  ["zai", (apiKey) => new ZaiProvider(apiKey)],
  ["anysearch", (apiKey) => new AnySearchProvider(apiKey)],
]);

export function createSearchProvider(name: string, creds: ProviderCredentials): SearchProvider | FullProvider {
  const apiKey = creds.apiKey ?? "";
  const factory = PROVIDER_FACTORIES.get(name);
  if (!factory) {
    throw new Error(`Unknown search provider: "${name}"`);
  }
  return factory(apiKey);
}
