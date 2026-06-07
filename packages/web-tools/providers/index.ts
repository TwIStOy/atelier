import type { ProviderMeta } from "./types.ts";

export { BraveProvider } from "./brave.ts";
export { type ProviderCredentials, createSearchProvider } from "./factory.ts";
export {
  htmlToText,
  extractTitle,
  isHtmlContentType,
  assertTextContentType,
  isPrivateOrLoopbackHostname,
  parseAndAssertHttpUrl,
  fetchUrlOrThrow,
  fetchViaGenericHtml,
} from "./fetch-helpers.ts";

export const BRAVE_API_KEY_ENV_VAR = "BRAVE_SEARCH_API_KEY";
export const BRAVE_PROVIDER_META: ProviderMeta = {
  name: "brave",
  label: "Brave",
  envVar: BRAVE_API_KEY_ENV_VAR,
  roles: ["search"] as const,
};

export const TAVILY_API_KEY_ENV_VAR = "TAVILY_API_KEY";
export const TAVILY_PROVIDER_META: ProviderMeta = {
  name: "tavily",
  label: "Tavily",
  envVar: TAVILY_API_KEY_ENV_VAR,
  roles: ["search", "fetch"] as const,
};

export const SERPER_API_KEY_ENV_VAR = "SERPER_API_KEY";
export const SERPER_PROVIDER_META: ProviderMeta = {
  name: "serper",
  label: "Serper",
  envVar: SERPER_API_KEY_ENV_VAR,
  roles: ["search"] as const,
};

export const EXA_API_KEY_ENV_VAR = "EXA_API_KEY";
export const EXA_PROVIDER_META: ProviderMeta = {
  name: "exa",
  label: "Exa",
  envVar: EXA_API_KEY_ENV_VAR,
  roles: ["search", "fetch"] as const,
};

export const YOUCOM_API_KEY_ENV_VAR = "YOUCOM_API_KEY";
export const YOUCOM_PROVIDER_META: ProviderMeta = {
  name: "youcom",
  label: "You.com",
  envVar: YOUCOM_API_KEY_ENV_VAR,
  roles: ["search", "fetch"] as const,
};

export const JINA_API_KEY_ENV_VAR = "JINA_API_KEY";
export const JINA_PROVIDER_META: ProviderMeta = {
  name: "jina",
  label: "Jina",
  envVar: JINA_API_KEY_ENV_VAR,
  roles: ["search", "fetch"] as const,
};

export const FIRECRAWL_API_KEY_ENV_VAR = "FIRECRAWL_API_KEY";
export const FIRECRAWL_PROVIDER_META: ProviderMeta = {
  name: "firecrawl",
  label: "Firecrawl",
  envVar: FIRECRAWL_API_KEY_ENV_VAR,
  roles: ["search", "fetch"] as const,
};

export const PERPLEXITY_API_KEY_ENV_VAR = "PERPLEXITY_API_KEY";
export const PERPLEXITY_PROVIDER_META: ProviderMeta = {
  name: "perplexity",
  label: "Perplexity",
  envVar: PERPLEXITY_API_KEY_ENV_VAR,
  roles: ["search"] as const,
};

export const PROVIDERS: readonly ProviderMeta[] = [
  BRAVE_PROVIDER_META,
  TAVILY_PROVIDER_META,
  SERPER_PROVIDER_META,
  EXA_PROVIDER_META,
  YOUCOM_PROVIDER_META,
  JINA_PROVIDER_META,
  FIRECRAWL_PROVIDER_META,
  PERPLEXITY_PROVIDER_META,
];
