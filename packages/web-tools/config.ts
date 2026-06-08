import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readConfig,
  registerConfigItems,
  type ExtensionConfigSchema,
} from "@htwang-contrib/common";
import { PROVIDERS } from "./providers/index.ts";
import {
  createSearchProvider,
  type ProviderCredentials,
} from "./providers/factory.ts";
import type { FullProvider, SearchProvider } from "./providers/types.ts";

export interface WebToolsConfig {
  provider: string;
  apiKeys: Record<string, string>;
  githubInterceptorEnabled: boolean;
  githubMaxRepoSizeMB: number;
  githubCloneTimeoutSeconds: number;
  githubClonePath: string;
}

export const CONFIG_SCHEMA: ExtensionConfigSchema<WebToolsConfig> = {
  defaults: {
    provider: "brave",
    apiKeys: {},
    githubInterceptorEnabled: false,
    githubMaxRepoSizeMB: 350,
    githubCloneTimeoutSeconds: 30,
    githubClonePath: join(tmpdir(), "pi-github-repos"),
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

export function registerWebToolsConfigItems(): void {
  registerConfigItems("web-tools", [
    {
      key: "provider",
      type: "select",
      label: "Search Provider",
      value: () => loadConfig().provider,
      description: "Active search backend",
      extensionLabel: "Web Tools",
      order: 0,
      options: PROVIDERS.map((p) => ({ label: p.label, value: p.name })),
    },
    ...PROVIDERS.map((p, i) => ({
      key: `apiKeys.${p.name}`,
      type: "string" as const,
      label: `${p.label} API Key`,
      value: () => resolveApiKey(p.name) ?? "",
      description: `${p.label} API key (env: ${p.envVar})`,
      extensionLabel: "Web Tools",
      order: 10 + i,
      secret: true,
      placeholder: `${p.envVar} or enter key here`,
      envVar: p.envVar,
    })),
    {
      key: "githubInterceptorEnabled",
      type: "boolean",
      label: "GitHub URL Interceptor",
      value: () => loadConfig().githubInterceptorEnabled,
      description: "Route github.com URLs through gh/git for repo content",
      extensionLabel: "Web Tools",
      order: 100,
    },
    {
      key: "githubMaxRepoSizeMB",
      type: "number",
      label: "GitHub Max Repo Size (MB)",
      value: () => loadConfig().githubMaxRepoSizeMB,
      description:
        "Repos above this threshold use the API view instead of cloning",
      extensionLabel: "Web Tools",
      order: 101,
      min: 10,
      max: 5000,
    },
    {
      key: "githubCloneTimeoutSeconds",
      type: "number",
      label: "GitHub Clone Timeout (seconds)",
      value: () => loadConfig().githubCloneTimeoutSeconds,
      description: "Timeout for git clone operations",
      extensionLabel: "Web Tools",
      order: 102,
      min: 5,
      max: 300,
    },
    {
      key: "githubClonePath",
      type: "string",
      label: "GitHub Clone Path",
      value: () => loadConfig().githubClonePath,
      description: "Directory where cloned repos are stored",
      extensionLabel: "Web Tools",
      order: 103,
      placeholder: join(tmpdir(), "pi-github-repos"),
    },
  ]);
}
