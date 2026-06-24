import type { ExtensionConfigSchema } from "@htwang-contrib/common";
import { readConfig, registerConfigItems, updateConfig } from "@htwang-contrib/common";

export interface ToolDisplayConfig {
  previewLines: number;
  diffMode: "auto" | "unified" | "side-by-side";
  splitDiffMinWidth: number;
  bashCommandDisplayLength: number;
}

const CONFIG_NAME = "tool-display";

const CONFIG_SCHEMA: ExtensionConfigSchema<ToolDisplayConfig> = {
  defaults: {
    previewLines: 3,
    diffMode: "auto",
    splitDiffMinWidth: 100,
    bashCommandDisplayLength: 60,
  },
};

export function loadConfig(): ToolDisplayConfig {
  return readConfig(CONFIG_NAME, CONFIG_SCHEMA);
}

export function saveConfig(patch: Partial<ToolDisplayConfig>): ToolDisplayConfig {
  return updateConfig(CONFIG_NAME, CONFIG_SCHEMA, patch);
}

export function registerToolDisplayConfigItems(): void {
  registerConfigItems(CONFIG_NAME, [
    {
      key: "previewLines",
      type: "number",
      label: "Preview Lines",
      value: () => loadConfig().previewLines,
      description: "Number of output lines shown in collapsed tool call view (default 3)",
      extensionLabel: "Tool Display",
      order: 0,
      min: 1,
      max: 50,
    },
    {
      key: "diffMode",
      type: "select",
      label: "Diff Mode",
      value: () => loadConfig().diffMode,
      description:
        'How edit diffs are rendered: "auto" picks side-by-side when terminal is wide enough, otherwise unified',
      extensionLabel: "Tool Display",
      order: 1,
      options: [
        { label: "Auto", value: "auto" },
        { label: "Side-by-side", value: "side-by-side" },
        { label: "Unified", value: "unified" },
      ],
    },
    {
      key: "splitDiffMinWidth",
      type: "number",
      label: "Split Diff Min Width",
      value: () => loadConfig().splitDiffMinWidth,
      description: 'Minimum terminal width to use side-by-side diff when diff mode is "auto" (default 100)',
      extensionLabel: "Tool Display",
      order: 2,
      min: 40,
      max: 400,
    },
    {
      key: "bashCommandDisplayLength",
      type: "number",
      label: "Bash Command Display Length",
      value: () => loadConfig().bashCommandDisplayLength,
      description:
        "Minimum characters shown for bash commands in the tool header (default 60). Wide terminals use the full available line width; this only caps the floor on narrow screens.",
      extensionLabel: "Tool Display",
      order: 3,
      min: 20,
      max: 500,
    },
  ]);
}
