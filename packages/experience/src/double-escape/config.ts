import { type ExtensionConfigSchema, readConfig } from "@htwang-contrib/common";

export const CONFIG_ID = "experience";

export interface DoubleEscapeConfig {
  doubleEscapeEnabled: boolean;
  doubleEscapeDebounceMs: number;
}

export const DEFAULT_DOUBLE_ESCAPE_CONFIG: DoubleEscapeConfig = {
  doubleEscapeEnabled: true,
  doubleEscapeDebounceMs: 600,
};

export const DOUBLE_ESCAPE_SCHEMA: ExtensionConfigSchema<DoubleEscapeConfig> = {
  defaults: DEFAULT_DOUBLE_ESCAPE_CONFIG,
};

export const DEBOUNCE_MIN_MS = 200;
export const DEBOUNCE_MAX_MS = 2000;

export function loadDoubleEscapeConfig(): DoubleEscapeConfig {
  const cfg = readConfig(CONFIG_ID, DOUBLE_ESCAPE_SCHEMA);
  const ms = Number(cfg.doubleEscapeDebounceMs);
  const debounceMs =
    Number.isFinite(ms) && ms >= 1
      ? Math.min(DEBOUNCE_MAX_MS, Math.max(1, Math.floor(ms)))
      : DEFAULT_DOUBLE_ESCAPE_CONFIG.doubleEscapeDebounceMs;
  return {
    doubleEscapeEnabled: cfg.doubleEscapeEnabled !== false,
    doubleEscapeDebounceMs: debounceMs,
  };
}

export const HINT_TEXT = "esc again to abort";
