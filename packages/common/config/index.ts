export { readConfig, writeConfig, updateConfig } from "./extension-config.ts";
export type { ExtensionConfigSchema } from "./extension-config.ts";
export {
  registerConfigItems,
  getConfigItems,
  clearConfigItems,
} from "./config-item.ts";
export type {
  ConfigItem,
  ConfigItemType,
  ConfigItemBase,
  StringConfigItem,
  NumberConfigItem,
  BooleanConfigItem,
  SelectConfigItem,
  MultiSelectConfigItem,
  ColorConfigItem,
  ConfigItemSelectOption,
  ConfigItemRegistry,
} from "./config-item.ts";
