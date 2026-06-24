import type { Theme } from "@earendil-works/pi-coding-agent";

export type ConfigItemType = "string" | "number" | "boolean" | "select" | "multiselect" | "reorderable" | "color";

export interface ConfigItemSelectOption<T = unknown> {
  label: string;
  value: T;
}

export interface ConfigItemPreviewContext {
  getValue: () => unknown;
  requestRender: () => void;
}

export interface ConfigItemPreviewHandle {
  render(width: number, theme: Theme): string[];
  dispose?(): void;
}

export type ConfigItemPreview = (ctx: ConfigItemPreviewContext) => ConfigItemPreviewHandle;

export interface ConfigItemBase<T, Type extends ConfigItemType = ConfigItemType> {
  key: string;
  type: Type;
  label: string;
  value: T | (() => T);
  description?: string;
  required?: boolean;
  group?: string;
  order?: number;
  secret?: boolean;
  envVar?: string;
  placeholder?: string;
  extensionLabel?: string;
  preview?: ConfigItemPreview;
}

export interface StringConfigItem extends ConfigItemBase<string, "string"> {
  pattern?: string;
}

export interface NumberConfigItem extends ConfigItemBase<number, "number"> {
  min?: number;
  max?: number;
}

export interface BooleanConfigItem extends ConfigItemBase<boolean, "boolean"> {}

export type LazyOptions<T> = () => ConfigItemSelectOption<T>[];

export interface SelectConfigItem<T = string> extends ConfigItemBase<T, "select"> {
  options: ConfigItemSelectOption<T>[] | LazyOptions<T>;
}

export interface MultiSelectConfigItem<T = string> extends ConfigItemBase<T[], "multiselect"> {
  options: ConfigItemSelectOption<T>[] | LazyOptions<T>;
}

export interface ReorderableConfigItem<T = string> extends ConfigItemBase<T[], "reorderable"> {
  options: ConfigItemSelectOption<T>[] | LazyOptions<T>;
}

export interface ColorConfigItem extends ConfigItemBase<string, "color"> {}

export type ConfigItem =
  | StringConfigItem
  | NumberConfigItem
  | BooleanConfigItem
  | SelectConfigItem
  | MultiSelectConfigItem
  | ReorderableConfigItem
  | ColorConfigItem;

export interface ConfigItemRegistry {
  extensionId: string;
  items: ConfigItem[];
}

type GlobalRegistry = Map<string, ConfigItem[]>;

const REGISTRY_KEY = "htwang-contrib-config-item-registry";

function getRegistry(): GlobalRegistry {
  const g = globalThis as unknown as Record<string, GlobalRegistry | undefined>;
  if (!g[REGISTRY_KEY]) {
    g[REGISTRY_KEY] = new Map();
  }
  return g[REGISTRY_KEY]!;
}

export function registerConfigItems(extensionId: string, items: ConfigItem[]): void {
  const registry = getRegistry();
  const existing = registry.get(extensionId) ?? [];
  const incomingKeys = new Set(items.map((i) => i.key));
  const merged = [...existing.filter((i) => !incomingKeys.has(i.key)), ...items];
  registry.set(extensionId, merged);
}

export function getConfigItems(extensionId: string): ConfigItem[];
export function getConfigItems(): ConfigItemRegistry[];
export function getConfigItems(extensionId?: string): ConfigItem[] | ConfigItemRegistry[] {
  const registry = getRegistry();
  if (extensionId !== undefined) {
    return registry.get(extensionId) ?? [];
  }
  return [...registry.entries()].map(([extensionId, items]) => ({
    extensionId,
    items,
  }));
}

export function clearConfigItems(extensionId?: string): void {
  const registry = getRegistry();
  if (extensionId !== undefined) {
    registry.delete(extensionId);
  } else {
    registry.clear();
  }
}
