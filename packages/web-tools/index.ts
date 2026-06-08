export type {
  SearchResult,
  SearchResponse,
  FetchResponse,
  SearchProvider,
  FetchProvider,
  FullProvider,
  ProviderRole,
  ProviderMeta,
} from "./providers/types.ts";

export {
  PROVIDERS,
  BRAVE_PROVIDER_META,
  TAVILY_PROVIDER_META,
  SERPER_PROVIDER_META,
  EXA_PROVIDER_META,
  YOUCOM_PROVIDER_META,
  JINA_PROVIDER_META,
  FIRECRAWL_PROVIDER_META,
  PERPLEXITY_PROVIDER_META,
  ZAI_PROVIDER_META,
} from "./providers/index.ts";

export { BraveProvider } from "./providers/brave.ts";
export { TavilyProvider } from "./providers/tavily.ts";
export { SerperProvider } from "./providers/serper.ts";
export { PerplexityProvider } from "./providers/perplexity.ts";
export { ExaProvider } from "./providers/exa.ts";
export { YouComProvider } from "./providers/youcom.ts";
export { JinaProvider } from "./providers/jina.ts";
export { FirecrawlProvider } from "./providers/firecrawl.ts";
export { ZaiProvider } from "./providers/zai.ts";
export {
  createSearchProvider,
  type ProviderCredentials,
} from "./providers/factory.ts";
export {
  htmlToText,
  extractTitle,
  isHtmlContentType,
  assertTextContentType,
  isPrivateOrLoopbackHostname,
  parseAndAssertHttpUrl,
  fetchUrlOrThrow,
  fetchViaGenericHtml,
} from "./providers/fetch-helpers.ts";

export {
  loadConfig,
  resolveApiKey,
  instantiateActiveProvider,
  registerWebToolsConfigItems,
  CONFIG_SCHEMA,
  type WebToolsConfig,
} from "./config.ts";

import { registerWebToolsConfigItems } from "./config.ts";
import { registerWebSearchTool } from "./search/index.ts";
import { registerWebFetchTool } from "./fetch/index.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export { registerWebSearchTool, registerWebFetchTool };

export default function (pi: ExtensionAPI): void {
  registerWebToolsConfigItems();
  registerWebSearchTool(pi);
  registerWebFetchTool(pi);
}
