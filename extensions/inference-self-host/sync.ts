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
};

const MODELS_DEV_URL = "https://models.dev/api.json";

const MODEL_SOURCES: Record<string, ModelSource> = {
  "mimo-v2-pro": { provider: "xiaomi", modelId: "mimo-v2-pro" },
  "glm-5": {
    provider: "zai-coding-plan",
    modelId: "glm-5",
    fallbacks: [{ provider: "zhipuai", modelId: "glm-5" }],
  },
  "glm-4.5-air": { provider: "zai-coding-plan", modelId: "glm-4.5-air" },
  "glm-4.5": { provider: "zhipuai", modelId: "glm-4.5" },
  "qwen3.5-plus": { provider: "alibaba", modelId: "qwen3.5-plus" },
  "glm-5.1": { provider: "zai-coding-plan", modelId: "glm-5.1" },
  "qwen3.7-max": { provider: "alibaba", modelId: "qwen3.7-max" },
  "glm-5-turbo": { provider: "zai-coding-plan", modelId: "glm-5-turbo" },
  "mimo-v2-omni": { provider: "xiaomi", modelId: "mimo-v2-omni" },
  "kimi-k2.6": { provider: "moonshotai", modelId: "kimi-k2.6" },
  "deepseek-v4-pro": { provider: "deepseek", modelId: "deepseek-v4-pro" },
  "minimax-m2.5": { provider: "minimax", modelId: "MiniMax-M2.5" },
  "minimax-m2.7": { provider: "minimax", modelId: "MiniMax-M2.7" },
  "hy3-preview": { provider: "tencent-tokenhub", modelId: "hy3-preview" },
  "kimi-k2.5": { provider: "moonshotai", modelId: "kimi-k2.5" },
  "mimo-v2.5": { provider: "xiaomi", modelId: "mimo-v2.5" },
  "qwen3.6-plus": { provider: "alibaba", modelId: "qwen3.6-plus" },
  "mimo-v2.5-pro": { provider: "xiaomi", modelId: "mimo-v2.5-pro" },
  "deepseek-v4-flash": { provider: "deepseek", modelId: "deepseek-v4-flash" },
  "glm-4.7": { provider: "zai-coding-plan", modelId: "glm-4.7" },
  "glm-4.6": { provider: "zhipuai", modelId: "glm-4.6" },
};

type ProviderModelConfig = {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
};

function toModelConfig(localId: string, raw: ModelsDevModel): ProviderModelConfig {
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
      console.warn(`Model "${source.modelId}" not found in provider "${source.provider}"`);
      continue;
    }
    models.push(toModelConfig(localId, raw));
  }
  return models;
}
