import { type ExtensionConfigSchema, readConfig } from "@htwang-contrib/common";

export interface HerdrConfig {
  enabled: boolean;
}

const CONFIG_SCHEMA: ExtensionConfigSchema<HerdrConfig> = {
  defaults: {
    enabled: true,
  },
};

export function loadConfig(): HerdrConfig {
  return readConfig("herdr", CONFIG_SCHEMA);
}
