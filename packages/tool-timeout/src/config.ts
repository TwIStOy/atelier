import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "@htwang-contrib/common";

export const CONFIG_ID = "tool-timeout";

export interface ToolTimeoutConfig {
  maxTimeoutSeconds: number;
}

export const DEFAULT_CONFIG: ToolTimeoutConfig = {
  maxTimeoutSeconds: 3600,
};

const CONFIG_SCHEMA: ExtensionConfigSchema<ToolTimeoutConfig> = {
  defaults: { ...DEFAULT_CONFIG },
};

export function normalizeMaxTimeoutSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_CONFIG.maxTimeoutSeconds;
  return Math.max(0, Math.floor(value));
}

export function loadConfig(): ToolTimeoutConfig {
  const config = readConfig(CONFIG_ID, CONFIG_SCHEMA);
  return { maxTimeoutSeconds: normalizeMaxTimeoutSeconds(config.maxTimeoutSeconds) };
}

export function resolveBashTimeoutSeconds(requested: unknown, maxSeconds: number): number {
  if (typeof requested === "number" && Number.isFinite(requested) && requested > 0) {
    return Math.min(requested, maxSeconds);
  }
  return maxSeconds;
}

export function registerConfig(): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "maxTimeoutSeconds",
      type: "number",
      label: "Max Timeout (seconds)",
      value: () => loadConfig().maxTimeoutSeconds,
      min: 0,
      max: 86400,
      description:
        "Wall-clock cap for every bash tool call. Calls without a timeout get this value; calls requesting a longer timeout are clamped to it. 0 disables the cap (pi's stock behavior: no default timeout).",
      extensionLabel: "Tool Timeout",
      order: 0,
    },
  ]);
}
