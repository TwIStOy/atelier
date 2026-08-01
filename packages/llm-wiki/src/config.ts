import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type ExtensionConfigSchema, readConfig, registerConfigItems, resolveModel } from "@htwang-contrib/common";

export interface LlmWikiConfig {
  ingestModel: string;
}

const CONFIG_ID = "llm-wiki";

const CONFIG_SCHEMA: ExtensionConfigSchema<LlmWikiConfig> = {
  defaults: { ingestModel: "" },
};

export function loadLlmWikiConfig(): LlmWikiConfig {
  const raw = readConfig(CONFIG_ID, CONFIG_SCHEMA);
  return { ingestModel: typeof raw.ingestModel === "string" ? raw.ingestModel : "" };
}

let cachedModelOptions: Array<{ label: string; value: string }> = [];

export function setCachedModelOptions(models: Array<{ label: string; value: string }>): void {
  cachedModelOptions = models;
}

export function registerLlmWikiConfigItems(): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "ingestModel",
      type: "select",
      label: "Wiki Ingest Model",
      value: () => loadLlmWikiConfig().ingestModel,
      description:
        "Model used for batch wiki_ingest side-calls (analysis + generation steps). Empty = use the session's current model.",
      extensionLabel: "LLM Wiki",
      options: () => [{ label: "(use session model)", value: "" }, ...cachedModelOptions],
    },
  ]);
}

type ResolvedModel = NonNullable<ExtensionContext["model"]>;

export function resolveIngestModel(ctx: ExtensionContext): ResolvedModel | null {
  const config = loadLlmWikiConfig();
  if (!config.ingestModel) {
    return ctx.model ?? null;
  }
  const resolved = resolveModel(ctx.modelRegistry.getAvailable(), config.ingestModel) as ResolvedModel | undefined;
  return resolved ?? ctx.model ?? null;
}
