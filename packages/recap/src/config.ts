import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { type ExtensionConfigSchema, readConfig, registerConfigItems, resolveModel } from "@htwang-contrib/common";

type AnyModel = Model<any>;

export const CONFIG_ID = "recap";

export const DEFAULT_IDLE_SECONDS = 300;

export interface RecapConfig {
  enabled: boolean;
  model: string;
  idleSeconds: number;
}

const CONFIG_SCHEMA: ExtensionConfigSchema<RecapConfig> = {
  defaults: {
    enabled: true,
    model: "",
    idleSeconds: DEFAULT_IDLE_SECONDS,
  },
};

export function loadRecapConfig(): RecapConfig {
  return readConfig(CONFIG_ID, CONFIG_SCHEMA);
}

let cachedModels: Array<{ label: string; value: string }> = [];

export function setCachedModels(models: Array<{ label: string; value: string }>): void {
  cachedModels = models;
}

export function registerRecapConfigItems(): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "enabled",
      type: "boolean",
      label: "Enable Recap",
      value: () => loadRecapConfig().enabled,
      description: "When on, generate a short session recap after the session goes idle.",
      extensionLabel: "Recap",
      order: 0,
    },
    {
      key: "model",
      type: "select",
      label: "Recap Model",
      value: () => loadRecapConfig().model,
      options: () => [{ label: "(session default)", value: "" }, ...cachedModels],
      description: "Model used for the recap side-call. Leave as (session default) to use the current session model.",
      extensionLabel: "Recap",
      order: 1,
    },
    {
      key: "idleSeconds",
      type: "number",
      label: "Idle Timeout (seconds)",
      value: () => loadRecapConfig().idleSeconds,
      min: 5,
      max: 3600,
      description:
        "How long the session must stay idle (no agent activity, no editor input) before a recap is generated.",
      extensionLabel: "Recap",
      order: 2,
    },
  ]);
}

/** Resolves the configured recap model pattern against the registry; undefined falls back to the session model. */
export function resolveRecapModel(registry: ModelRegistry, config: RecapConfig): AnyModel | undefined {
  if (!config.model) return undefined;
  return (resolveModel(registry.getAvailable(), config.model) as AnyModel) ?? undefined;
}
