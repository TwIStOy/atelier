import type { RefreshModelsContext, ThinkingLevelMap } from "@earendil-works/pi-ai";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { fetchGatewayModels, refreshModelsCatalog } from "@htwang-contrib/common";

type ChatModelConfig = Extract<ProviderModelConfig, { type?: "chat" }>;

export const API_KEY = "magpie-private";
const GATEWAY_V1_BASE_URL = "http://100.65.0.3:3425/v1";
const DEFAULT_CONTEXT_WINDOW = 200000;
const DEFAULT_MAX_TOKENS = 16384;
const PI_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const EFFORT_ALIASES: Record<string, string> = {
  light: "low",
  extra_high: "xhigh",
};

type MagpieReasoningLevel = {
  effort?: string;
};

type MagpiePricing = {
  prompt?: string;
  completion?: string;
  input_cache_read?: string;
  input_cache_write?: string;
};

type MagpieModel = {
  id?: string;
  object?: string;
  display_name?: string;
  context_window?: number;
  context_length?: number;
  max_output_tokens?: number;
  modalities?: { input?: string[] };
  native_endpoints?: string[];
  reasoning?: boolean;
  reasoning_levels?: string[];
  supported_reasoning_levels?: MagpieReasoningLevel[];
  pricing?: MagpiePricing;
};

type MagpieModelsResponse = {
  data?: MagpieModel[];
};

const MAGPIE_COMPAT: NonNullable<ChatModelConfig["compat"]> = {
  sendSessionAffinityHeaders: true,
};

const CHAT_ENDPOINT = "/v1/chat/completions";
const RESPONSES_ENDPOINT = "/v1/responses";
const MESSAGES_ENDPOINT = "/v1/messages";

type ApiChoice = {
  api: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";
  baseUrl?: string;
};

function gatewayRoot(v1BaseUrl: string): string {
  const url = new URL(v1BaseUrl.endsWith("/") ? v1BaseUrl : `${v1BaseUrl}/`);
  url.pathname = url.pathname.replace(/\/v1\/$/, "/");
  return url.toString().replace(/\/$/, "");
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (trimmed === "/chat/completions") return CHAT_ENDPOINT;
  if (trimmed === "/responses") return RESPONSES_ENDPOINT;
  if (trimmed === "/messages") return MESSAGES_ENDPOINT;
  return trimmed;
}

function pickApi(endpoints: readonly string[] | undefined, v1BaseUrl: string): ApiChoice {
  if (!endpoints || endpoints.length === 0) return { api: "openai-completions" };
  const native = new Set(endpoints.map(normalizeEndpoint));
  if (native.has(CHAT_ENDPOINT)) return { api: "openai-completions" };
  if (native.has(RESPONSES_ENDPOINT)) return { api: "openai-responses" };
  const root = gatewayRoot(v1BaseUrl);
  if (native.has(MESSAGES_ENDPOINT)) return { api: "anthropic-messages", baseUrl: root };
  if ([...native].some((endpoint) => endpoint.includes(":generateContent") || endpoint.startsWith("/v1beta/models/"))) {
    return { api: "google-generative-ai", baseUrl: `${root}/v1beta` };
  }
  return { api: "openai-completions" };
}

function reasoningLevels(entry: MagpieModel): string[] {
  const named = entry.reasoning_levels;
  const source = named ?? entry.supported_reasoning_levels?.map((level) => level.effort ?? "") ?? [];
  return source.map((level) => level.trim().toLowerCase()).filter((level) => level.length > 0);
}

function modelEffort(efforts: readonly string[], level: string): string | undefined {
  if (efforts.includes(level)) return level;
  return efforts.find((effort) => (EFFORT_ALIASES[effort] ?? effort) === level);
}

function thinkingLevelMap(efforts: readonly string[]): ThinkingLevelMap | undefined {
  if (efforts.length === 0) return undefined;
  const map: ThinkingLevelMap = {};
  for (const level of PI_LEVELS) {
    const wanted = level === "off" ? "none" : level;
    map[level] = modelEffort(efforts, wanted) ?? null;
  }
  return map;
}

function perMillion(perToken: string | undefined): number {
  if (!perToken) return 0;
  const trimmed = perToken.trim();
  const decimal = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!decimal) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    return numeric * 1_000_000;
  }
  const whole = decimal[1] ?? "0";
  const frac = decimal[2] ?? "";
  const scale = 6;
  const shifted =
    frac.length <= scale
      ? { intDigits: whole + frac.padEnd(scale, "0"), fracDigits: "" }
      : { intDigits: whole + frac.slice(0, scale), fracDigits: frac.slice(scale).replace(/0+$/, "") };
  const intDigits = shifted.intDigits.replace(/^0+(?=\d)/, "");
  const text = shifted.fracDigits ? `${intDigits}.${shifted.fracDigits}` : intDigits;
  const value = Number(text);
  return Number.isFinite(value) ? value : 0;
}

function toModelConfig(entry: MagpieModel, v1BaseUrl: string): ProviderModelConfig | undefined {
  if (!entry.id) return undefined;
  if (entry.object !== undefined && entry.object !== "model") return undefined;

  const efforts = reasoningLevels(entry);
  const input: ("text" | "image")[] = entry.modalities?.input?.includes("image") ? ["text", "image"] : ["text"];
  const pricing = entry.pricing;
  const chosen = pickApi(entry.native_endpoints, v1BaseUrl);
  const config: ChatModelConfig = {
    id: entry.id,
    name: entry.display_name?.trim() || entry.id,
    api: chosen.api,
    reasoning: entry.reasoning === true || efforts.length > 0,
    input,
    cost: {
      input: perMillion(pricing?.prompt),
      output: perMillion(pricing?.completion),
      cacheRead: perMillion(pricing?.input_cache_read),
      cacheWrite: perMillion(pricing?.input_cache_write),
    },
    contextWindow: entry.context_window ?? entry.context_length ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: entry.max_output_tokens ?? DEFAULT_MAX_TOKENS,
    compat: MAGPIE_COMPAT,
  };
  if (chosen.baseUrl) config.baseUrl = chosen.baseUrl;
  const levels = thinkingLevelMap(efforts);
  if (levels) config.thinkingLevelMap = levels;
  return config;
}

export async function fetchCatalog(
  context: RefreshModelsContext,
  baseUrl: string = GATEWAY_V1_BASE_URL,
): Promise<ProviderModelConfig[]> {
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${API_KEY}`,
  };

  const payload = await fetchGatewayModels<MagpieModelsResponse>(baseUrl, headers, context.signal);
  const seen = new Set<string>();
  const models: ProviderModelConfig[] = [];
  for (const entry of payload.data ?? []) {
    const config = toModelConfig(entry, baseUrl);
    if (!config || seen.has(config.id)) continue;
    seen.add(config.id);
    models.push(config);
  }
  return models;
}

export async function refreshCatalog(context: RefreshModelsContext): Promise<ProviderModelConfig[]> {
  return refreshModelsCatalog(context, fetchCatalog);
}
