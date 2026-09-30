import type { Api, ModelsStoreEntry, RefreshModelsContext } from "@earendil-works/pi-ai";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

type ChatModelConfig = Extract<ProviderModelConfig, { type?: "chat" }>;

export const ENV_VAR = "INFERENCE_V2_TWISTOY_API_KEY";
const GATEWAY_V1_BASE_URL = "https://toori.twistoy.cn/api/v1";
const GATEWAY_ROOT_BASE_URL = "https://toori.twistoy.cn/api";
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

const GPT_56_THINKING_LEVEL_MAP: NonNullable<ChatModelConfig["thinkingLevelMap"]> = {
  off: "none",
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

const ZAI_COMPAT: NonNullable<ChatModelConfig["compat"]> = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens",
  thinkingFormat: "zai",
  zaiToolStream: true,
};

const ZAI_COMPAT_REASONING_EFFORT: NonNullable<ChatModelConfig["compat"]> = {
  ...ZAI_COMPAT,
  supportsReasoningEffort: true,
};

const GLM_REASONING_EFFORT_IDS = new Set(["glm-5.2", "glm-5.3"]);

const GLM_REASONING_EFFORT_MAP: NonNullable<ChatModelConfig["thinkingLevelMap"]> = {
  minimal: null,
  low: "high",
  medium: "high",
  high: "high",
  max: "max",
};

const DEEPSEEK_COMPAT: NonNullable<ChatModelConfig["compat"]> = {
  supportsStore: false,
  supportsDeveloperRole: false,
  requiresReasoningContentOnAssistantMessages: true,
  thinkingFormat: "deepseek",
};

const DEEPSEEK_MAX_TOKENS = 65536;

const DEEPSEEK_THINKING_LEVEL_MAP: NonNullable<ChatModelConfig["thinkingLevelMap"]> = {
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  max: "max",
};

const MOONSHOT_COMPAT: NonNullable<ChatModelConfig["compat"]> = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens",
  supportsStrictMode: false,
  thinkingFormat: "deepseek",
};

const KIMI_K3_COMPAT: NonNullable<ChatModelConfig["compat"]> = {
  allowEmptySignature: true,
  forceAdaptiveThinking: true,
};

const KIMI_K3_THINKING_LEVEL_MAP: NonNullable<ChatModelConfig["thinkingLevelMap"]> = {
  off: null,
  minimal: null,
  low: "low",
  medium: null,
  high: "high",
  xhigh: null,
  max: "max",
};

const QWEN_COMPAT: NonNullable<ChatModelConfig["compat"]> = {
  supportsStore: false,
  supportsDeveloperRole: false,
  thinkingFormat: "qwen",
};

const MIMO_COMPAT: NonNullable<ChatModelConfig["compat"]> = {
  requiresReasoningContentOnAssistantMessages: true,
  thinkingFormat: "deepseek",
};

const HY3_COMPAT: NonNullable<ChatModelConfig["compat"]> = {
  supportsStore: false,
  supportsDeveloperRole: false,
};

const GROK_45_THINKING_LEVEL_MAP: NonNullable<ChatModelConfig["thinkingLevelMap"]> = {
  off: null,
  minimal: null,
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

function applyFamilyOverrides(config: ChatModelConfig, api: Api): void {
  const id = config.id;
  if (id.startsWith("gpt-5.6-")) {
    config.thinkingLevelMap = GPT_56_THINKING_LEVEL_MAP;
    return;
  }
  if (id.startsWith("gpt-6-")) {
    config.thinkingLevelMap = GPT_56_THINKING_LEVEL_MAP;
    return;
  }
  if (GLM_REASONING_EFFORT_IDS.has(id)) {
    config.compat = ZAI_COMPAT_REASONING_EFFORT;
    config.thinkingLevelMap = GLM_REASONING_EFFORT_MAP;
    return;
  }
  if (id.startsWith("glm-")) {
    config.compat = ZAI_COMPAT;
    return;
  }
  if (id.startsWith("deepseek-")) {
    config.compat = DEEPSEEK_COMPAT;
    config.thinkingLevelMap = DEEPSEEK_THINKING_LEVEL_MAP;
    config.maxTokens = DEEPSEEK_MAX_TOKENS;
    return;
  }
  if (id === "kimi-k3") {
    config.api = "anthropic-messages";
    config.baseUrl = GATEWAY_ROOT_BASE_URL;
    config.compat = KIMI_K3_COMPAT;
    config.thinkingLevelMap = KIMI_K3_THINKING_LEVEL_MAP;
    return;
  }
  if (id.startsWith("kimi-")) {
    config.compat = MOONSHOT_COMPAT;
    return;
  }
  if (id.startsWith("qwen")) {
    config.compat = QWEN_COMPAT;
    return;
  }
  if (id.startsWith("mimo-")) {
    config.compat = MIMO_COMPAT;
    return;
  }
  if (id.startsWith("hy3")) {
    config.compat = HY3_COMPAT;
    return;
  }
  if (id === "grok-4.5") {
    if (api === "openai-responses") {
      config.compat = { supportsLongCacheRetention: false };
      config.thinkingLevelMap = GROK_45_THINKING_LEVEL_MAP;
    }
    return;
  }
}

const BRAND_DISPLAY_NAMES: Record<string, string> = {
  glm: "GLM",
  gpt: "GPT",
  claude: "Claude",
  deepseek: "DeepSeek",
  kimi: "Kimi",
  qwen: "Qwen",
  mimo: "MIMO",
  hy3: "HY3",
  grok: "Grok",
};

function formatNameSegment(segment: string): string {
  const brand = BRAND_DISPLAY_NAMES[segment.toLowerCase()];
  if (brand) return brand;
  if (/^[\d.]+$/.test(segment)) return segment;
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function guessDisplayName(id: string): string {
  const segments = id.split("-").filter((s) => s.length > 0);
  if (segments.length === 0) return id;

  let versionStart = segments.length;
  while (versionStart > 0 && /^\d+$/.test(segments[versionStart - 1])) {
    versionStart--;
  }

  const tokens: string[] = [];
  for (let i = 0; i < versionStart; i++) tokens.push(formatNameSegment(segments[i]));

  if (segments.length - versionStart >= 2) {
    tokens.push(segments.slice(versionStart).join("."));
  } else {
    for (let i = versionStart; i < segments.length; i++) tokens.push(formatNameSegment(segments[i]));
  }

  return tokens.join(" ");
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

  if (entry.supported_formats?.some((format) => format === "typesafe-systemone" || format === "typesafe-system-one")) {
    return {
      type: "classifier",
      id: entry.id,
      name: guessDisplayName(entry.id),
      api: "typesafe-system-one",
      input,
      cost,
      contextWindow: entry.context_window ?? DEFAULT_CONTEXT_WINDOW,
    };
  }

  const config: ChatModelConfig = {
    id: entry.id,
    name: guessDisplayName(entry.id),
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

  applyFamilyOverrides(config, api);

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
  if (!context.allowNetwork || context.signal?.aborted) {
    return storedAsConfig(context.stored);
  }
  if (
    !context.force &&
    context.stored?.checkedAt !== undefined &&
    Date.now() - context.stored.checkedAt < REFRESH_INTERVAL_MS
  ) {
    return storedAsConfig(context.stored);
  }
  const refreshed = await fetchCatalog(context);
  if (context.signal?.aborted) return storedAsConfig(context.stored);
  await context.publish({
    persist: {
      models: refreshed as unknown as ModelsStoreEntry["models"],
      checkedAt: Date.now(),
    },
  });
  return refreshed;
}

function storedAsConfig(stored: { models: readonly ProviderModelConfig[] } | undefined): ProviderModelConfig[] {
  return [...(stored?.models ?? [])] as ProviderModelConfig[];
}
