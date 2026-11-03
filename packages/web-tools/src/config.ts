import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "@htwang-contrib/common";
import { ProviderError } from "./providers/errors.ts";
import { createSearchProvider } from "./providers/factory.ts";
import { PROVIDERS } from "./providers/index.ts";
import type { FullProvider, SearchProvider } from "./providers/types.ts";

export interface WebToolsConfig {
  providers: string[];
  apiKeys: Record<string, string>;
  githubInterceptorEnabled: boolean;
  githubMaxRepoSizeMB: number;
  githubCloneTimeoutSeconds: number;
  githubClonePath: string;
}

export const CONFIG_SCHEMA: ExtensionConfigSchema<WebToolsConfig> = {
  defaults: {
    providers: PROVIDERS.map((p) => p.name),
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

export function isRateLimitError(err: unknown): boolean {
  return err instanceof ProviderError && err.isRateLimit;
}

export function instantiateProviders(): {
  providerNames: string[];
  providers: Array<{ name: string; provider: SearchProvider | FullProvider }>;
} {
  const config = loadConfig();
  const names = config.providers.length > 0 ? config.providers : ["brave"];
  const providers = names.map((name) => {
    const apiKey = resolveApiKey(name);
    const provider = createSearchProvider(name, { apiKey: apiKey ?? "" });
    return { name, provider };
  });
  return { providerNames: names, providers };
}

export function registerWebToolsConfigItems(): void {
  registerConfigItems("web-tools", [
    {
      key: "providers",
      type: "reorderable",
      label: "Search Providers",
      value: () => loadConfig().providers,
      description: "Ordered provider chain. Search tries the next provider when one fails.",
      extensionLabel: "Web Tools",
      order: 0,
      options: () =>
        PROVIDERS.map((p) => ({
          label: resolveApiKey(p.name) ? `${p.label} ✓` : `${p.label} ✗`,
          value: p.name,
        })),
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
      description: "Repos above this threshold use the API view instead of cloning",
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
