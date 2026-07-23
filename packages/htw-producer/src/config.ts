import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "@htwang-contrib/common";

export interface HtwProducerConfig {
  enabled: boolean;
  host: string;
  port: number;
}

export const CONFIG_ID = "htw-producer";

export const DEFAULT_CONFIG: HtwProducerConfig = {
  enabled: true,
  host: "127.0.0.1",
  port: 7482,
};

export const CONFIG_SCHEMA: ExtensionConfigSchema<HtwProducerConfig> = {
  defaults: { ...DEFAULT_CONFIG },
};

export function loadConfig(): HtwProducerConfig {
  return readConfig(CONFIG_ID, CONFIG_SCHEMA);
}

export function registerHtwProducerConfigItems(): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "enabled",
      type: "boolean",
      label: "Enabled",
      value: () => loadConfig().enabled,
      description: "Push session snapshots to the htw daemon. When off, no reports are sent.",
      extensionLabel: "HTW Producer",
      order: 0,
    },
    {
      key: "host",
      type: "string",
      label: "Daemon Host",
      value: () => loadConfig().host,
      description: "htw daemon bind address (default 127.0.0.1).",
      extensionLabel: "HTW Producer",
      order: 10,
    },
    {
      key: "port",
      type: "number",
      label: "Daemon Port",
      value: () => loadConfig().port,
      min: 1,
      max: 65535,
      description: "htw daemon port (default 7482).",
      extensionLabel: "HTW Producer",
      order: 20,
    },
  ]);
}
