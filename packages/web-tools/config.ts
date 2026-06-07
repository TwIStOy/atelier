import { readConfig, type ExtensionConfigSchema } from "@htwang-contrib/common";
import { PROVIDERS } from "./providers/index.ts";
import {
  createSearchProvider,
  type ProviderCredentials,
} from "./providers/factory.ts";
import type { FullProvider, SearchProvider } from "./providers/types.ts";

export interface WebToolsConfig {
  provider: string;
  apiKeys: Record<string, string>;
}

export const CONFIG_SCHEMA: ExtensionConfigSchema<WebToolsConfig> = {
  defaults: {
    provider: "brave",
    apiKeys: {},
  },
};

export function loadConfig(): WebToolsConfig {
  return readConfig("web-tools", CONFIG_SCHEMA);
}

export function resolveApiKey(providerName: string): string | undefined {
  const meta = PROVIDERS.find((p) => p.name === providerName);
  const envKey = meta?.envVar ? process.env[meta.envVar]?.trim() : undefined;
  if (envKey) return envKey;
  return loadConfig().apiKeys[providerName]?.trim();
}

export function instantiateActiveProvider(): {
  providerName: string;
  provider: SearchProvider | FullProvider;
} {
  const config = loadConfig();
  const providerName = config.provider;
  const apiKey = resolveApiKey(providerName);
  const provider = createSearchProvider(providerName, {
    apiKey: apiKey ?? "",
  });
  return { providerName, provider };
}
