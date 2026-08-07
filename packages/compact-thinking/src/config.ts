import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "@htwang-contrib/common";
import type { CompactThinkingConfig } from "./types.ts";

export const CONFIG_ID = "compact-thinking";

export const DEFAULT_CONFIG: CompactThinkingConfig = {
  previewLines: 3,
  animationIntervalMs: 90,
};

export const CONFIG_SCHEMA: ExtensionConfigSchema<CompactThinkingConfig> = {
  defaults: { ...DEFAULT_CONFIG },
};

export function loadConfig(): CompactThinkingConfig {
  return readConfig(CONFIG_ID, CONFIG_SCHEMA);
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
  ]);
}
