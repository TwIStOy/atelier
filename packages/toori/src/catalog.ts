import type { Api, RefreshModelsContext } from "@earendil-works/pi-ai";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { fetchGatewayModels, refreshModelsCatalog } from "@htwang-contrib/common";

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
  supports_developer_role?: boolean;
  available_thinking_levels?: string[];
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
  thinkingFormat: "qwen",
};

const MIMO_COMPAT: NonNullable<ChatModelConfig["compat"]> = {
  requiresReasoningContentOnAssistantMessages: true,
  thinkingFormat: "deepseek",
};

const HY3_COMPAT: NonNullable<ChatModelConfig["compat"]> = {
  supportsStore: false,
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

function applyGptGlmOverrides(config: ChatModelConfig): boolean {
  const id = config.id;
  if (id.startsWith("gpt-5.6-")) {
    config.thinkingLevelMap = GPT_56_THINKING_LEVEL_MAP;
    return true;
  }
  if (id.startsWith("gpt-6-")) {
    config.thinkingLevelMap = GPT_56_THINKING_LEVEL_MAP;
    return true;
  }
  if (GLM_REASONING_EFFORT_IDS.has(id)) {
    config.compat = ZAI_COMPAT_REASONING_EFFORT;
    config.thinkingLevelMap = GLM_REASONING_EFFORT_MAP;
    return true;
  }
  if (id.startsWith("glm-")) {
    config.compat = ZAI_COMPAT;
    return true;
  }
  return false;
}

function applyChineseFamilyOverrides(config: ChatModelConfig): boolean {
  const id = config.id;
  if (id.startsWith("deepseek-")) {
    config.compat = DEEPSEEK_COMPAT;
    config.thinkingLevelMap = DEEPSEEK_THINKING_LEVEL_MAP;
    config.maxTokens = DEEPSEEK_MAX_TOKENS;
    return true;
  }
  if (id === "kimi-k3") {
    config.api = "anthropic-messages";
    config.baseUrl = GATEWAY_ROOT_BASE_URL;
    config.compat = KIMI_K3_COMPAT;
    config.thinkingLevelMap = KIMI_K3_THINKING_LEVEL_MAP;
    return true;
  }
  if (id.startsWith("kimi-")) {
    config.compat = MOONSHOT_COMPAT;
    return true;
  }
  if (id.startsWith("qwen")) {
    config.compat = QWEN_COMPAT;
    return true;
  }
  if (id.startsWith("mimo-")) {
    config.compat = MIMO_COMPAT;
    return true;
  }
  if (id.startsWith("hy3")) {
    config.compat = HY3_COMPAT;
    return true;
  }
  return false;
}

function applyGrokOverride(config: ChatModelConfig, api: Api): void {
  if (config.id !== "grok-4.5") return;
  if (api === "openai-responses") {
    config.compat = { supportsLongCacheRetention: false };
    config.thinkingLevelMap = GROK_45_THINKING_LEVEL_MAP;
  }
}

function applyFamilyOverrides(config: ChatModelConfig, api: Api): void {
  if (applyGptGlmOverrides(config)) return;
  if (applyChineseFamilyOverrides(config)) return;
  applyGrokOverride(config, api);
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
  if (/^[a-z]{2}$/.test(segment)) return segment.toUpperCase();
  if (/^[\d.]+$/.test(segment)) return segment;
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

const GROUP_ID_PREFIX = "group:";

export function guessDisplayName(id: string): string {
  if (id.startsWith(GROUP_ID_PREFIX)) {
    const rest = id.slice(GROUP_ID_PREFIX.length);
    if (rest.length === 0) return id;
    return `${guessDisplayName(rest)} [Group]`;
  }

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

type GatewayCost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

type ModelInputModalities = ("text" | "image")[];

function hasImageInput(capabilities: GatewayCapabilities | undefined): boolean {
  const modalities = capabilities?.supported_input_modalities;
  return modalities?.includes("image") ?? false;
}

function resolveModelInput(capabilities: GatewayCapabilities | undefined): ModelInputModalities {
  return hasImageInput(capabilities) ? ["text", "image"] : ["text"];
}

function gatewayCostRate(tier: GatewayCostTier | undefined, key: "input" | "output" | "cache_read"): number {
  return tier?.[key] ?? 0;
}

function resolveCost(entry: GatewayModelObject): GatewayCost {
  const tier = entry.cost?.[0];
  return {
    input: gatewayCostRate(tier, "input"),
    output: gatewayCostRate(tier, "output"),
    cacheRead: gatewayCostRate(tier, "cache_read"),
    cacheWrite: 0,
  };
}

function isTypesafeClassifier(entry: GatewayModelObject): boolean {
  const formats = entry.supported_formats;
  if (!formats) return false;
  return formats.some((format) => format === "typesafe-systemone" || format === "typesafe-system-one");
}

function toClassifierModelConfig(
  entry: GatewayModelObject,
  input: ModelInputModalities,
  cost: GatewayCost,
): ProviderModelConfig {
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

function toChatModelConfig(
  entry: GatewayModelObject,
  api: Api,
  input: ModelInputModalities,
  cost: GatewayCost,
): ChatModelConfig {
  return {
    id: entry.id,
    name: guessDisplayName(entry.id),
    api,
    reasoning: entry.capabilities?.supports_reasoning ?? true,
    input,
    cost,
    contextWindow: entry.context_window ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}

function applyDeveloperRoleCompat(config: ChatModelConfig, capabilities: GatewayCapabilities | undefined): void {
  config.compat = { ...config.compat, supportsDeveloperRole: capabilities?.supports_developer_role ?? true };
}

function levelOrHidden(levels: ReadonlySet<string>, level: string): string | null {
  return levels.has(level) ? level : null;
}

function applyGroupThinkingLevels(config: ChatModelConfig, capabilities: GatewayCapabilities | undefined): void {
  const available = capabilities?.available_thinking_levels;
  if (!config.id.startsWith("group:") || !available) return;
  const levels = new Set(available);
  config.thinkingLevelMap = {
    minimal: levelOrHidden(levels, "minimal"),
    low: levelOrHidden(levels, "low"),
    medium: levelOrHidden(levels, "medium"),
    high: levelOrHidden(levels, "high"),
    xhigh: levelOrHidden(levels, "xhigh"),
    max: levelOrHidden(levels, "max"),
  };
}

function toModelConfig(entry: GatewayModelObject): ProviderModelConfig {
  const api = pickApi(entry);
  const capabilities = entry.capabilities;
  const input = resolveModelInput(capabilities);
  const cost = resolveCost(entry);

  if (isTypesafeClassifier(entry)) {
    return toClassifierModelConfig(entry, input, cost);
  }

  const config = toChatModelConfig(entry, api, input, cost);

  if (api === "anthropic-messages") {
    config.baseUrl = GATEWAY_ROOT_BASE_URL;
  }

  applyFamilyOverrides(config, api);

  applyDeveloperRoleCompat(config, capabilities);
  applyGroupThinkingLevels(config, capabilities);

  return config;
}

export async function fetchCatalog(
  context: RefreshModelsContext,
  baseUrl: string = GATEWAY_V1_BASE_URL,
): Promise<ProviderModelConfig[]> {
  const apiKey = resolveApiKey(context);
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const payload = await fetchGatewayModels<GatewayModelsResponse>(baseUrl, headers, context.signal);
  const entries = payload.data ?? [];
  return entries.map(toModelConfig);
}

export async function refreshCatalog(context: RefreshModelsContext): Promise<ProviderModelConfig[]> {
  return refreshModelsCatalog(context, fetchCatalog);
}
