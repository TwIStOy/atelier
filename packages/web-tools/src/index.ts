export {
  CONFIG_SCHEMA,
  instantiateProviders,
  isRateLimitError,
  loadConfig,
  registerWebToolsConfigItems,
  resolveApiKey,
  type WebToolsConfig,
} from "./config.ts";
export { BraveProvider } from "./providers/brave.ts";
export { ExaProvider } from "./providers/exa.ts";
export {
  createSearchProvider,
  type ProviderCredentials,
} from "./providers/factory.ts";
export {
  assertTextContentType,
  extractTitle,
  fetchUrlOrThrow,
  fetchViaGenericHtml,
  htmlToText,
  isHtmlContentType,
  isPrivateOrLoopbackHostname,
  parseAndAssertHttpUrl,
} from "./providers/fetch-helpers.ts";
export { FirecrawlProvider } from "./providers/firecrawl.ts";
export {
  BRAVE_PROVIDER_META,
  EXA_PROVIDER_META,
  FIRECRAWL_PROVIDER_META,
  JINA_PROVIDER_META,
  PERPLEXITY_PROVIDER_META,
  PROVIDERS,
  SERPER_PROVIDER_META,
  TAVILY_PROVIDER_META,
  YOUCOM_PROVIDER_META,
  ZAI_PROVIDER_META,
} from "./providers/index.ts";
export { JinaProvider } from "./providers/jina.ts";
export { PerplexityProvider } from "./providers/perplexity.ts";
export { SerperProvider } from "./providers/serper.ts";
export { TavilyProvider } from "./providers/tavily.ts";
export type {
  FetchProvider,
  FetchResponse,
  FullProvider,
  ProviderMeta,
  ProviderRole,
  SearchProvider,
  SearchResponse,
  SearchResult,
} from "./providers/types.ts";
export { YouComProvider } from "./providers/youcom.ts";
export { ZaiProvider } from "./providers/zai.ts";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLogger } from "@htwang-contrib/common";
import { registerWebToolsConfigItems } from "./config.ts";
import { registerWebFetchTool } from "./fetch/index.ts";
import { buildInterceptors } from "./interceptors/index.ts";
import { registerWebSearchTool } from "./search/index.ts";

const logger = createLogger("web-tools");

export {
  GitHubInterceptor,
  type GitHubInterceptorOptions,
  type GitHubUrlInfo,
  type UrlInterceptor,
} from "./interceptors/index.ts";
export { ProviderError, throwIfApiError } from "./providers/errors.ts";
export { registerWebFetchTool, registerWebSearchTool };

export default function (pi: ExtensionAPI): void {
  logger.info("extension loaded");
  registerWebToolsConfigItems();
  buildInterceptors();
  registerWebSearchTool(pi);
  registerWebFetchTool(pi);
}
