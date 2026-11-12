import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "@htwang-contrib/common/config";
import { resolveModel } from "@htwang-contrib/common/model-resolve";

type AnyModel = Model<any>;

const CONFIG_ID = "rex-title";

export interface RexTitleConfig {
  model: string;
}

const CONFIG_SCHEMA: ExtensionConfigSchema<RexTitleConfig> = {
  defaults: { model: "" },
};

export function loadRexTitleConfig(): RexTitleConfig {
  return readConfig(CONFIG_ID, CONFIG_SCHEMA);
}

export function registerRexTitleConfigItems(registry: ModelRegistry): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "model",
      type: "select",
      label: "Title Model",
      value: () => loadRexTitleConfig().model,
      options: () => [
        { label: "(session default)", value: "" },
        ...registry.getAvailable().map((model) => ({
          label: `${model.provider} · ${model.name || model.id}`,
          value: `${model.provider}/${model.id}`,
        })),
      ],
      description:
        "Model used to summarize session titles. Leave as (session default) to use the active session model.",
      extensionLabel: "Rex Title",
      order: 0,
    },
  ]);
}

export function resolveRexTitleModel(registry: ModelRegistry, config: RexTitleConfig): AnyModel | undefined {
  if (!config.model) return undefined;
  return resolveModel(registry.getAvailable(), config.model) as AnyModel | undefined;
}
