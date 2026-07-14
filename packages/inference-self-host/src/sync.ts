import { createLogger } from "@htwang-contrib/common";

const logger = createLogger("inference-self-host");

type ModelsDevCost = {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
};

type ModelsDevLimit = {
  context: number;
  output: number;
};

type ModelsDevModel = {
  id: string;
  name: string;
  reasoning: boolean;
  modalities: { input: string[] };
  cost: ModelsDevCost;
  limit: ModelsDevLimit;
};

type ModelsDevResponse = Record<
  string,
  {
    name: string;
    models: Record<string, ModelsDevModel>;
  }
>;

type ModelSource = {
  provider: string;
  modelId: string;
  fallbacks?: { provider: string; modelId: string }[];
  compatFamily?: "zai" | "deepseek" | "moonshot" | "qwen" | "anthropic";
};

const MODELS_DEV_URL = "https://models.dev/api.json";

const MODEL_SOURCES: Record<string, ModelSource> = {
  "mimo-v2-pro": { provider: "opencode-go", modelId: "mimo-v2-pro" },
  "glm-5": {
    provider: "opencode-go",
    modelId: "glm-5",
    fallbacks: [
      { provider: "zai-coding-plan", modelId: "glm-5" },
      { provider: "zhipuai", modelId: "glm-5" },
    ],
    compatFamily: "zai",
  },
  "glm-4.5-air": {
    provider: "zai-coding-plan",
    modelId: "glm-4.5-air",
    fallbacks: [{ provider: "zhipuai", modelId: "glm-4.5-air" }],
    compatFamily: "zai",
  },
  "glm-4.5": { provider: "zhipuai", modelId: "glm-4.5", compatFamily: "zai" },
  "qwen3.5-plus": {
    provider: "opencode-go",
    modelId: "qwen3.5-plus",
    compatFamily: "qwen",
  },
  "glm-5.1": {
    provider: "opencode-go",
    modelId: "glm-5.1",
    fallbacks: [{ provider: "zai-coding-plan", modelId: "glm-5.1" }],
    compatFamily: "zai",
  },
  "qwen3.7-max": {
    provider: "opencode-go",
    modelId: "qwen3.7-max",
    compatFamily: "qwen",
  },
  "glm-5-turbo": {
    provider: "zai-coding-plan",
    modelId: "glm-5-turbo",
    compatFamily: "zai",
  },
  "mimo-v2-omni": { provider: "opencode-go", modelId: "mimo-v2-omni" },
  "kimi-k2.6": {
    provider: "opencode-go",
    modelId: "kimi-k2.6",
    compatFamily: "moonshot",
  },
  "deepseek-v4-pro": {
    provider: "opencode-go",
    modelId: "deepseek-v4-pro",
    compatFamily: "deepseek",
  },
  "minimax-m2.5": { provider: "opencode-go", modelId: "minimax-m2.5" },
  "minimax-m2.7": { provider: "opencode-go", modelId: "minimax-m2.7" },
  "hy3-preview": { provider: "tencent-tokenhub", modelId: "hy3-preview" },
  "kimi-k2.5": {
    provider: "opencode-go",
    modelId: "kimi-k2.5",
    compatFamily: "moonshot",
  },
  "mimo-v2.5": { provider: "opencode-go", modelId: "mimo-v2.5" },
  "qwen3.6-plus": {
    provider: "opencode-go",
    modelId: "qwen3.6-plus",
    compatFamily: "qwen",
  },
  "mimo-v2.5-pro": { provider: "opencode-go", modelId: "mimo-v2.5-pro" },
  "deepseek-v4-flash": {
    provider: "opencode-go",
    modelId: "deepseek-v4-flash",
    compatFamily: "deepseek",
  },
  "glm-4.7": {
    provider: "zai-coding-plan",
    modelId: "glm-4.7",
    fallbacks: [{ provider: "zhipuai", modelId: "glm-4.7" }],
    compatFamily: "zai",
  },
  "glm-4.6": { provider: "zhipuai", modelId: "glm-4.6", compatFamily: "zai" },
  "gpt-5.5": {
    provider: "openai",
    modelId: "gpt-5.5",
    fallbacks: [
      { provider: "azure", modelId: "gpt-5.5" },
      { provider: "github-copilot", modelId: "gpt-5.5" },
    ],
  },
  "gpt-5.6-sol": {
    provider: "openai",
    modelId: "gpt-5.6-sol",
    fallbacks: [{ provider: "github-copilot", modelId: "gpt-5.6-sol" }],
  },
  "gpt-5.6-terra": {
    provider: "openai",
    modelId: "gpt-5.6-terra",
    fallbacks: [{ provider: "github-copilot", modelId: "gpt-5.6-terra" }],
  },
  "gpt-5.6-luna": {
    provider: "openai",
    modelId: "gpt-5.6-luna",
    fallbacks: [{ provider: "github-copilot", modelId: "gpt-5.6-luna" }],
  },
  "gpt-image-2": {
    provider: "openai",
    modelId: "gpt-image-2",
  },
  "gpt-5.4-mini": {
    provider: "openai",
    modelId: "gpt-5.4-mini",
    fallbacks: [
      { provider: "azure", modelId: "gpt-5.4-mini" },
      { provider: "github-copilot", modelId: "gpt-5.4-mini" },
    ],
  },
  "claude-haiku-4-5-20251001": {
    provider: "anthropic",
    modelId: "claude-haiku-4-5-20251001",
    fallbacks: [
      {
        provider: "amazon-bedrock",
        modelId: "anthropic.claude-haiku-4-5-20251001-v1:0",
      },
    ],
    compatFamily: "anthropic",
  },
  "claude-fable-5": {
    provider: "anthropic",
    modelId: "claude-fable-5",
    compatFamily: "anthropic",
  },
  "claude-sonnet-4-6": {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    fallbacks: [{ provider: "amazon-bedrock", modelId: "anthropic.claude-sonnet-4-6" }],
    compatFamily: "anthropic",
  },
  "claude-opus-4-7": {
    provider: "anthropic",
    modelId: "claude-opus-4-7",
    compatFamily: "anthropic",
  },
  "claude-opus-4-8": {
    provider: "anthropic",
    modelId: "claude-opus-4-8",
    compatFamily: "anthropic",
  },
};

type ProviderModelConfig = {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  compatFamily?: "zai" | "deepseek" | "moonshot" | "qwen" | "anthropic";
};

function toModelConfig(localId: string, raw: ModelsDevModel, source: ModelSource): ProviderModelConfig {
  const input = raw.modalities?.input?.includes("image") ? ["text", "image"] : ["text"];
  return {
    id: localId,
    name: raw.name,
    reasoning: raw.reasoning,
    input: input as ("text" | "image")[],
    cost: {
      input: raw.cost?.input ?? 0,
      output: raw.cost?.output ?? 0,
      cacheRead: raw.cost?.cache_read ?? 0,
      cacheWrite: raw.cost?.cache_write ?? 0,
    },
    contextWindow: raw.limit.context,
    maxTokens: raw.limit.output,
    compatFamily: source.compatFamily,
  };
}

export async function fetchModels(): Promise<ProviderModelConfig[]> {
  const resp = await fetch(MODELS_DEV_URL);
  if (!resp.ok) throw new Error(`Failed to fetch models.dev: ${resp.status}`);
  const data: ModelsDevResponse = await resp.json();

  function resolve(source: ModelSource): ModelsDevModel | undefined {
    return data[source.provider]?.models?.[source.modelId];
  }

  const models: ProviderModelConfig[] = [];
  for (const [localId, source] of Object.entries(MODEL_SOURCES)) {
    let raw = resolve(source);
    if (!raw && source.fallbacks) {
      for (const fb of source.fallbacks) {
        raw = resolve(fb);
        if (raw) break;
      }
    }
    if (!raw) {
      logger.warn(`Model "${source.modelId}" not found in provider "${source.provider}"`);
      continue;
    }
    models.push(toModelConfig(localId, raw, source));
  }
  return models;
}
