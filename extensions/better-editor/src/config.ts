import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "@htwang-contrib/common";

export type BorderColorMode = "dim" | "border" | "thinkingLevel";

export interface BetterEditorConfig {
  borderColor: BorderColorMode;
  doubleEscapeEnabled: boolean;
  doubleEscapeDebounceMs: number;
}

const CONFIG_NAME = "better-editor";
const DEBOUNCE_MIN_MS = 200;
const DEBOUNCE_MAX_MS = 2000;

const CONFIG_SCHEMA: ExtensionConfigSchema<BetterEditorConfig> = {
  defaults: {
    borderColor: "dim",
    doubleEscapeEnabled: true,
    doubleEscapeDebounceMs: 600,
  },
};

export function loadConfig(): BetterEditorConfig {
  const config = readConfig(CONFIG_NAME, CONFIG_SCHEMA);
  const ms = Number(config.doubleEscapeDebounceMs);
  return {
    borderColor: config.borderColor,
    doubleEscapeEnabled: config.doubleEscapeEnabled !== false,
    doubleEscapeDebounceMs:
      Number.isFinite(ms) && ms >= 1
        ? Math.min(DEBOUNCE_MAX_MS, Math.max(1, Math.floor(ms)))
        : CONFIG_SCHEMA.defaults.doubleEscapeDebounceMs,
  };
}

export function registerBetterEditorConfigItems(): void {
  registerConfigItems(CONFIG_NAME, [
    {
      key: "borderColor",
      type: "select",
      label: "Editor Border Color",
      value: () => loadConfig().borderColor,
      options: [
        { label: "Fixed dim", value: "dim" },
        { label: "Fixed border color", value: "border" },
        { label: "Follow thinking level", value: "thinkingLevel" },
      ],
      description: "Use a fixed theme color for the editor border or follow the current thinking level.",
      extensionLabel: "BetterEditor",
      order: 0,
    },
    {
      key: "doubleEscapeEnabled",
      type: "boolean",
      label: "Double-Escape to Abort",
      value: () => loadConfig().doubleEscapeEnabled,
      description:
        "Require two interrupt key presses to abort a streaming response. The first shows 'esc again to abort' in the editor border. Autocomplete still closes with one press.",
      extensionLabel: "BetterEditor",
      order: 1,
    },
    {
      key: "doubleEscapeDebounceMs",
      type: "number",
      label: "Double-Escape Window (ms)",
      value: () => loadConfig().doubleEscapeDebounceMs,
      min: DEBOUNCE_MIN_MS,
      max: DEBOUNCE_MAX_MS,
      description: "Time allowed between the first and second interrupt key presses before the hint resets.",
      extensionLabel: "BetterEditor",
      order: 2,
    },
  ]);
}
