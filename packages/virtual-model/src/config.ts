import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { COMPLEXITY_TIERS, type ExtensionConfigSchema, readConfig, registerConfigItems } from "@htwang-contrib/common";

export const CONFIG_ID = "virtual-model";

export interface VirtualModelConfig {
  flashModel: string;
  middleModel: string;
  flagshipModel: string;
  judgeModel: string;
  judgeTimeoutMs: number;
}

const SCHEMA: ExtensionConfigSchema<VirtualModelConfig> = {
  defaults: {
    flashModel: "",
    middleModel: "",
    flagshipModel: "",
    judgeModel: "typesafe/jev-latest",
    judgeTimeoutMs: 30_000,
  },
};

export function loadConfig(): VirtualModelConfig {
  const config = readConfig(CONFIG_ID, SCHEMA);
  for (const key of ["flashModel", "middleModel", "flagshipModel", "judgeModel"] as const) {
    if (typeof config[key] !== "string") throw new Error(`Virtual Model: ${key} must be a provider/model string.`);
    config[key] = config[key].trim();
  }
  if (!Number.isSafeInteger(config.judgeTimeoutMs) || config.judgeTimeoutMs < 1 || config.judgeTimeoutMs > 300_000) {
    throw new Error("Virtual Model: judgeTimeoutMs must be an integer between 1 and 300000.");
  }
  return config;
}

export function splitModelReference(reference: string): [string, string] {
  const separator = reference.indexOf("/");
  if (separator < 1 || separator === reference.length - 1) {
    throw new Error(
      `Virtual Model: configure a complete provider/model reference in /config (received ${JSON.stringify(reference)}).`,
    );
  }
  return [reference.slice(0, separator), reference.slice(separator + 1)];
}

export function resolvePhysicalModel(registry: ModelRegistry, reference: string): Model<Api> {
  const model = registry.find(...splitModelReference(reference));
  if (!model) throw new Error(`Virtual Model: chat model ${reference} is not registered.`);
  if (model.api === "pi-virtual") throw new Error(`Virtual Model: ${reference} must be a physical model.`);
  return model;
}

export function registerSettings(getRegistry: () => ModelRegistry | undefined): void {
  const chatOptions = () =>
    (getRegistry()?.getAll() ?? [])
      .filter((model) => model.api !== "pi-virtual")
      .map((model) => ({ label: `${model.provider}/${model.id}`, value: `${model.provider}/${model.id}` }));

  registerConfigItems(CONFIG_ID, [
    ...COMPLEXITY_TIERS.map((tier, order) => ({
      key: `${tier}Model`,
      type: "select" as const,
      label: `${tier[0].toUpperCase()}${tier.slice(1)} Model`,
      value: () => readConfig(CONFIG_ID, SCHEMA)[`${tier}Model`],
      options: () => [{ label: "(not configured)", value: "" }, ...chatOptions()],
      description: `Physical model for the ${tier} tier. Use increasing capability from flash to flagship.`,
      extensionLabel: "Virtual Model",
      order,
    })),
    {
      key: "judgeModel",
      type: "select",
      label: "Judge Model",
      value: () => readConfig(CONFIG_ID, SCHEMA).judgeModel,
      options: () => [
        ...(getRegistry()?.getModelsOfType("classifier") ?? []).map((model) => ({
          label: `${model.provider}/${model.id} (classifier)`,
          value: `${model.provider}/${model.id}`,
        })),
        ...chatOptions(),
      ],
      description:
        "A classifier such as Jev or a physical chat model. Uses that provider's Pi authentication and endpoint settings.",
      extensionLabel: "Virtual Model",
      order: 3,
    },
    {
      key: "judgeTimeoutMs",
      type: "number",
      label: "Judge Timeout (ms)",
      value: () => readConfig(CONFIG_ID, SCHEMA).judgeTimeoutMs,
      min: 1,
      max: 300_000,
      description:
        "Total time allowed for a complexity decision. A failed decision stops the request without changing its tier.",
      extensionLabel: "Virtual Model",
      order: 4,
    },
  ]);
}
