import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "@htwang-contrib/common";
import type { CompactThinkingConfig } from "./types.ts";

export const CONFIG_ID = "compact-thinking";

export const DEFAULT_CONFIG: CompactThinkingConfig = {
  previewLines: 3,
  animationIntervalMs: 90,
  summaryEnabled: false,
  summaryModel: "",
};

export const CONFIG_SCHEMA: ExtensionConfigSchema<CompactThinkingConfig> = {
  defaults: { ...DEFAULT_CONFIG },
};

export function loadConfig(): CompactThinkingConfig {
  return readConfig(CONFIG_ID, CONFIG_SCHEMA);
}

let cachedModelOptions: Array<{ label: string; value: string }> = [];

export function setCachedModelOptions(models: Array<{ label: string; value: string }>): void {
  cachedModelOptions = models;
}

export function registerCompactThinkingConfigItems(): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "previewLines",
      type: "number",
      label: "Preview Lines",
      value: () => loadConfig().previewLines,
      min: 0,
      max: 50,
      description: "Number of trailing thinking lines shown under the compact heading. 0 hides the preview.",
      extensionLabel: "Compact Thinking",
      order: 0,
    },
    {
      key: "animationIntervalMs",
      type: "number",
      label: "Animation Interval",
      value: () => loadConfig().animationIntervalMs,
      min: 20,
      max: 1000,
      description: "Milliseconds between highlight-animation frames while thinking is active.",
      extensionLabel: "Compact Thinking",
      order: 10,
    },
    {
      key: "summaryEnabled",
      type: "boolean",
      label: "Summary Enabled",
      value: () => loadConfig().summaryEnabled,
      description:
        "After a thinking run finishes, send it to a side model for a one-line summary that replaces the compact preview.",
      extensionLabel: "Compact Thinking",
      order: 20,
    },
    {
      key: "summaryModel",
      type: "select",
      label: "Summary Model",
      value: () => loadConfig().summaryModel,
      description:
        "Model used for thinking summaries. Cheap models work well. Empty = use the session's current model.",
      extensionLabel: "Compact Thinking",
      order: 30,
      options: () => [{ label: "(use session model)", value: "" }, ...cachedModelOptions],
    },
  ]);
}
