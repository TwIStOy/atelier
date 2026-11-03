import {
  DEFAULT_SPINNER,
  type ExtensionConfigSchema,
  readConfig,
  registerConfigItems,
  SPINNER_STYLES,
} from "@htwang-contrib/common";
import { DEFAULT_NARROW_WIDTH_SPINNER, DEFAULT_NARROW_WIDTH_THRESHOLD } from "./narrow-screen.ts";
import { createSpinnerPreview } from "./preview.ts";

export interface WorkingIndicatorConfig {
  spinner: string;
  narrowWidthEnabled: boolean;
  narrowWidthThreshold: number;
  narrowWidthSpinner: string;
}

const CONFIG_ID = "working-indicator";

const DEFAULT_CONFIG: WorkingIndicatorConfig = {
  spinner: DEFAULT_SPINNER,
  narrowWidthEnabled: true,
  narrowWidthThreshold: DEFAULT_NARROW_WIDTH_THRESHOLD,
  narrowWidthSpinner: DEFAULT_NARROW_WIDTH_SPINNER,
};

const CONFIG_SCHEMA: ExtensionConfigSchema<WorkingIndicatorConfig> = {
  defaults: { ...DEFAULT_CONFIG },
};

export function loadConfig(): WorkingIndicatorConfig {
  return readConfig(CONFIG_ID, CONFIG_SCHEMA);
}

export function registerWorkingIndicatorConfigItems(): void {
  const spinnerOptions = Object.entries(SPINNER_STYLES).map(([value, style]) => ({
    label: `${style.frames[0]}  ${value} · ${style.intervalMs}ms`,
    value,
  }));

  registerConfigItems(CONFIG_ID, [
    {
      key: "spinner",
      type: "select",
      label: "Spinner Style",
      value: () => loadConfig().spinner,
      options: spinnerOptions,
      description: "Spinner preset: the glyph sequence, its visual width, and frame interval.",
      extensionLabel: "Working Indicator",
      order: 0,
      preview: createSpinnerPreview(),
    },
    {
      key: "narrowWidthEnabled",
      type: "boolean",
      label: "Narrow-Width Switch",
      value: () => loadConfig().narrowWidthEnabled,
      description: "When on, the spinner switches to the narrow preset when the terminal is narrow (likely a phone).",
      extensionLabel: "Working Indicator",
      order: 10,
    },
    {
      key: "narrowWidthThreshold",
      type: "number",
      label: "Narrow-Width Threshold",
      value: () => loadConfig().narrowWidthThreshold,
      min: 1,
      max: 200,
      description: "Terminal width (columns) at or below which the screen is treated as narrow.",
      extensionLabel: "Working Indicator",
      order: 11,
    },
    {
      key: "narrowWidthSpinner",
      type: "select",
      label: "Narrow-Width Spinner",
      value: () => loadConfig().narrowWidthSpinner,
      options: spinnerOptions,
      description: "Spinner preset used while the terminal is narrow. Defaults to dots.",
      extensionLabel: "Working Indicator",
      order: 12,
      preview: createSpinnerPreview(),
    },
  ]);
}
