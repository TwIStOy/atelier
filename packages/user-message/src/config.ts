import {
  type ClassifierRegistry,
  classifierModelOptions,
  DEFAULT_CLASSIFIER_MODEL,
} from "@htwang-contrib/common/classifier-models";
import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "@htwang-contrib/common/config";

export const USER_MESSAGE_CONFIG_ID = "user-message";

export interface UserMessageConfig {
  classifierModel: string;
  complexityAssessment: boolean;
}

const CONFIG_SCHEMA: ExtensionConfigSchema<UserMessageConfig> = {
  defaults: {
    classifierModel: DEFAULT_CLASSIFIER_MODEL,
    complexityAssessment: true,
  },
};

let classifierRegistry: ClassifierRegistry | undefined;

export function setClassifierRegistry(registry: ClassifierRegistry | undefined): void {
  classifierRegistry = registry;
}

export function loadConfig(): UserMessageConfig {
  return readConfig(USER_MESSAGE_CONFIG_ID, CONFIG_SCHEMA);
}

export function registerUserMessageConfigItems(): void {
  registerConfigItems(USER_MESSAGE_CONFIG_ID, [
    {
      key: "classifierModel",
      type: "select",
      label: "Classifier Model",
      value: () => loadConfig().classifierModel,
      options: () => {
        const options = classifierModelOptions(classifierRegistry);
        const current = loadConfig().classifierModel;
        return options.some((option) => option.value === current)
          ? options
          : [...options, { label: current, value: current }];
      },
      description:
        "Decision model asked for the model-tier probability row. Magpie registers jev-latest; other providers list their own classifier models.",
      extensionLabel: "User Message",
      order: 0,
    },
    {
      key: "complexityAssessment",
      type: "boolean",
      label: "Complexity Assessment",
      value: () => loadConfig().complexityAssessment,
      description: "Show model tier probabilities below user messages",
      extensionLabel: "User Message",
      order: 1,
    },
  ]);
}
