export {
  readConfig,
  writeConfig,
  updateConfig,
  readRawConfig,
  setConfigKey,
  deleteConfigKey,
  deleteConfigSection,
} from "./extension-config.ts";
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
  ReorderableConfigItem,
  ColorConfigItem,
  ConfigItemSelectOption,
  ConfigItemPreview,
  ConfigItemPreviewHandle,
  ConfigItemPreviewContext,
  LazyOptions,
  ConfigItemRegistry,
} from "./config-item.ts";
