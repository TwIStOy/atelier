import {
  type ExtensionConfigSchema,
  getConfigEnvVar,
  readConfig,
  registerConfigItems,
  resolveConfigValue,
} from "@htwang-contrib/common/config";

export const MAGPIE_CONFIG_ID = "magpie";
export const DEFAULT_MAGPIE_URL = "http://100.65.0.3:3425";

export interface MagpieConfig {
  url: string;
  apiKey: string;
  classifierModels: string;
  classifierTimeoutMs: number;
  classifierMaxRetries: number;
}

const CONFIG_SCHEMA: ExtensionConfigSchema<MagpieConfig> = {
  defaults: {
    url: DEFAULT_MAGPIE_URL,
    apiKey: "magpie-private",
    classifierModels: "group/classifier",
    classifierTimeoutMs: 10_000,
    classifierMaxRetries: 2,
  },
};

export function loadMagpieConfig(): MagpieConfig {
  const config = readConfig(MAGPIE_CONFIG_ID, CONFIG_SCHEMA);
  const apiKey = resolveConfigValue(config.apiKey);
  return {
    ...config,
    url: process.env.MAGPIE_BASE_URL?.trim() || config.url,
    apiKey: getConfigEnvVar(config.apiKey) === undefined ? process.env.MAGPIE_API_KEY?.trim() || apiKey : apiKey,
  };
}

export function magpieClassifierIds(config: MagpieConfig = loadMagpieConfig()): string[] {
  const ids = config.classifierModels
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return [...new Set(ids)];
}

export interface MagpieEndpoint {
  baseUrl: string;
  apiKey: string;
}

export function magpieEndpoint(config: MagpieConfig = loadMagpieConfig()): MagpieEndpoint {
  return { baseUrl: `${config.url.trim().replace(/\/+$/, "")}/v1`, apiKey: config.apiKey };
}

export function registerMagpieConfigItems(): void {
  registerConfigItems(MAGPIE_CONFIG_ID, [
    {
      key: "url",
      type: "string",
      label: "Gateway URL",
      value: () => loadMagpieConfig().url,
      description: "Gateway root without /v1. Model lists use /v1/models and classifier requests use /v1/systemone.",
      extensionLabel: "Magpie",
      envVar: "MAGPIE_BASE_URL",
      order: 0,
    },
    {
      key: "apiKey",
      type: "string",
      label: "API Key",
      value: () => readConfig(MAGPIE_CONFIG_ID, CONFIG_SCHEMA).apiKey,
      description:
        "Gateway key or $VAR / {env:VAR} reference. References take precedence; otherwise MAGPIE_API_KEY overrides a literal key.",
      extensionLabel: "Magpie",
      secret: true,
      envVar: "MAGPIE_API_KEY",
      placeholder: "$MY_MAGPIE_KEY or {env:MY_MAGPIE_KEY}",
      order: 1,
    },
    {
      key: "classifierModels",
      type: "string",
      label: "Classifier Models",
      value: () => loadMagpieConfig().classifierModels,
      description:
        "Decision model ids registered as Pi classifier models on /v1/systemone, comma or space separated (magpie's model list does not include them).",
      extensionLabel: "Magpie",
      order: 2,
    },
    {
      key: "classifierTimeoutMs",
      type: "number",
      label: "Classifier Timeout (ms)",
      value: () => loadMagpieConfig().classifierTimeoutMs,
      description: "Timeout per attempt, including response body delivery. Retries have separate timeouts.",
      extensionLabel: "Magpie",
      min: 1,
      order: 3,
    },
    {
      key: "classifierMaxRetries",
      type: "number",
      label: "Classifier Max Retries",
      value: () => loadMagpieConfig().classifierMaxRetries,
      description: "Retries after the initial attempt for transient failures. Zero disables retries.",
      extensionLabel: "Magpie",
      min: 0,
      order: 4,
    },
  ]);
}
