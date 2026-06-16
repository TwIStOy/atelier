import {
  readConfig,
  registerConfigItems,
  type ExtensionConfigSchema,
} from "@htwang-contrib/common";
import { DEFAULT_SPINNER, SPINNER_STYLES } from "@htwang-contrib/common";
import { createSpinnerPreview } from "./preview.ts";

export interface WorkingIndicatorConfig {
  spinner: string;
}

export const CONFIG_ID = "working-indicator";

export const DEFAULT_CONFIG: WorkingIndicatorConfig = {
  spinner: DEFAULT_SPINNER,
};

export const CONFIG_SCHEMA: ExtensionConfigSchema<WorkingIndicatorConfig> = {
  defaults: { ...DEFAULT_CONFIG },
};

export function loadConfig(): WorkingIndicatorConfig {
  return readConfig(CONFIG_ID, CONFIG_SCHEMA);
}

export function registerWorkingIndicatorConfigItems(): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "spinner",
      type: "select",
      label: "Spinner Style",
      value: () => loadConfig().spinner,
      options: Object.entries(SPINNER_STYLES).map(([value, style]) => ({
        label: `${style.frames[0]}  ${value} · ${style.intervalMs}ms`,
        value,
      })),
      description:
        "Spinner preset: the glyph sequence, its visual width, and frame interval.",
      extensionLabel: "Working Indicator",
      order: 0,
      preview: createSpinnerPreview(),
    },
  ]);
}
