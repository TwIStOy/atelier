import type { Api, ModelsStoreEntry, RefreshModelsContext } from "@earendil-works/pi-ai";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

const ENV_VAR = "INFERENCE_V2_TWISTOY_API_KEY";
const GATEWAY_V1_BASE_URL = "https://inference-v2.twistoy.cn/api/v1";
const GATEWAY_ROOT_BASE_URL = "https://inference-v2.twistoy.cn/api";
const DEFAULT_CONTEXT_WINDOW = 200000;
const DEFAULT_MAX_TOKENS = 128000;

type GatewayCostTier = {
  input?: number;
  output?: number;
  cache_read?: number;
  unit?: string;
};

type GatewayCapabilities = {
  supported_input_modalities?: string[];
  supported_output_modalities?: string[];
  supports_streaming?: boolean;
  supports_tool_use?: boolean;
  supports_vision?: boolean;
  supports_reasoning?: boolean;
  supports_json_output?: boolean;
  supports_system_prompt?: boolean;
};

type GatewayModelObject = {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  supported_formats?: string[];
  context_window?: number;
  cost?: GatewayCostTier[];
  capabilities?: GatewayCapabilities;
};

type GatewayModelsResponse = {
  object?: string;
  data?: GatewayModelObject[];
};

const API_PREFERENCE: readonly Api[] = ["openai-responses", "openai-completions", "anthropic-messages"];

const ZAI_COMPAT: NonNullable<ProviderModelConfig["compat"]> = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  thinkingFormat: "zai",
  zaiToolStream: true,
};

const GLM_5_2_THINKING_LEVEL_MAP: NonNullable<ProviderModelConfig["thinkingLevelMap"]> = {
  minimal: null,
  low: "high",
  medium: "high",
  high: "high",
  xhigh: "max",
};

function resolveApiKey(context: RefreshModelsContext): string | undefined {
  const credential = context.credential;
  if (credential?.type === "api_key" && credential.key) return credential.key;
  return process.env[ENV_VAR];
}

function pickApi(entry: GatewayModelObject): Api {
  const formats = new Set(entry.supported_formats ?? []);
  for (const api of API_PREFERENCE) {
    if (formats.has(api)) return api;
  }
  return "openai-completions";
}

function toModelConfig(entry: GatewayModelObject): ProviderModelConfig {
  const api = pickApi(entry);
  const capabilities = entry.capabilities;
  const hasImage = capabilities?.supported_input_modalities?.includes("image") ?? false;
  const input = hasImage ? (["text", "image"] as ("text" | "image")[]) : (["text"] as ("text" | "image")[]);

  const tier = entry.cost?.[0];
  const cost = {
    input: tier?.input ?? 0,
    output: tier?.output ?? 0,
    cacheRead: tier?.cache_read ?? 0,
    cacheWrite: 0,
  };

  const config: ProviderModelConfig = {
    id: entry.id,
    name: entry.id,
    api,
    reasoning: capabilities?.supports_reasoning ?? true,
    input,
    cost,
    contextWindow: entry.context_window ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  };

  if (api === "anthropic-messages") {
    config.baseUrl = GATEWAY_ROOT_BASE_URL;
  }

  if (entry.id === "glm-5.2") {
    config.compat = ZAI_COMPAT;
    config.thinkingLevelMap = GLM_5_2_THINKING_LEVEL_MAP;
  }

  return config;
}

export async function fetchCatalog(
  context: RefreshModelsContext,
  baseUrl: string = GATEWAY_V1_BASE_URL,
): Promise<ProviderModelConfig[]> {
  const apiKey = resolveApiKey(context);
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const url = new URL("models", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
  const response = await fetch(url, { headers, signal: context.signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  const payload = (await response.json()) as GatewayModelsResponse;
  const entries = payload.data ?? [];
  return entries.map(toModelConfig);
}

const REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

export async function refreshCatalog(context: RefreshModelsContext): Promise<ProviderModelConfig[]> {
  const stored = await context.store.read();
  if (!context.allowNetwork || context.signal?.aborted) {
    return storedAsConfig(stored);
  }
  if (!context.force && stored?.checkedAt !== undefined && Date.now() - stored.checkedAt < REFRESH_INTERVAL_MS) {
    return storedAsConfig(stored);
  }
  const refreshed = await fetchCatalog(context);
  if (context.signal?.aborted) return storedAsConfig(stored);
  await context.store.write({
    models: refreshed as unknown as ModelsStoreEntry["models"],
    checkedAt: Date.now(),
  });
  return refreshed;
}

function storedAsConfig(stored: { models: readonly ProviderModelConfig[] } | undefined): ProviderModelConfig[] {
  return [...(stored?.models ?? [])] as ProviderModelConfig[];
}
