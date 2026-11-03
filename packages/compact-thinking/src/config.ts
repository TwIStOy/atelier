import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "@htwang-contrib/common";
import type { CompactThinkingConfig } from "./types.ts";

const CONFIG_ID = "compact-thinking";

const DEFAULT_CONFIG: CompactThinkingConfig = {
  previewLines: 3,
  animationIntervalMs: 45,
  blockSpacing: 0,
  summaryEnabled: false,
  summaryModel: "",
  summaryMinChars: 2000,
};

const CONFIG_SCHEMA: ExtensionConfigSchema<CompactThinkingConfig> = {
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
      key: "blockSpacing",
      type: "number",
      label: "Blank Lines Around Thinking",
      value: () => loadConfig().blockSpacing,
      min: 0,
      max: 5,
      description:
        "Blank lines before and after each thinking block. 0 keeps the rail column continuous with tool lines; always at least 1 against user messages and visible text.",
      extensionLabel: "Compact Thinking",
      order: 5,
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
      key: "summaryMinChars",
      type: "number",
      label: "Summary Min Chars",
      value: () => loadConfig().summaryMinChars,
      min: 0,
      max: 200000,
      description: "Only summarize thinking runs longer than this many characters. Shorter runs keep the raw preview.",
      extensionLabel: "Compact Thinking",
      order: 25,
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
