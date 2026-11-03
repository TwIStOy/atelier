import { fuzzyFilter } from "@earendil-works/pi-tui";
import type {
  ConfigItemRegistry,
  ConfigItemSelectOption,
  MultiSelectConfigItem,
  ReorderableConfigItem,
  SelectConfigItem,
} from "@htwang-contrib/common";
import { deleteConfigKey, getConfigItems, readRawConfig, setConfigKey } from "@htwang-contrib/common";
import type { SettingRow, TabDef } from "./types.ts";
import { PACKAGE_TAB_PREFIX, TAB_ALL } from "./types.ts";

function resolveOptions<T>(
  options: ConfigItemSelectOption<T>[] | (() => ConfigItemSelectOption<T>[]),
): ConfigItemSelectOption<T>[] {
  return typeof options === "function" ? options() : options;
}

function resolveValue<T>(value: T | (() => T)): T {
  return typeof value === "function" ? (value as () => T)() : value;
}

export function buildSettingRows(): SettingRow[] {
  const registries = getConfigItems() as ConfigItemRegistry[];
  const rows: SettingRow[] = [];

  for (const { extensionId, items } of registries) {
    const rawSection = readRawConfig(extensionId);

    const extLabel = items.length > 0 && items[0]!.extensionLabel ? items[0]!.extensionLabel! : extensionId;

    for (const item of items) {
      const currentValue = resolveValue(item.value);
      const isExplicit = rawSection ? item.key in rawSection : false;

      rows.push({
        id: `${extensionId}::${item.key}`,
        extensionId,
        extensionLabel: extLabel,
        item,
        currentValue,
        isExplicit,
      });
    }
  }

  return rows.sort((a, b) => {
    const ext = a.extensionId.localeCompare(b.extensionId);
    if (ext !== 0) return ext;
    return (a.item.order ?? 0) - (b.item.order ?? 0);
  });
}

export function buildTabs(rows: SettingRow[]): TabDef[] {
  const tabs: TabDef[] = [{ id: TAB_ALL, label: "All" }];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.extensionId)) continue;
    seen.add(row.extensionId);
    tabs.push({
      id: `${PACKAGE_TAB_PREFIX}${row.extensionId}`,
      label: row.extensionLabel,
      extensionId: row.extensionId,
    });
  }
  return tabs;
}

export function filterRows(rows: SettingRow[], search: string, tab: string): SettingRow[] {
  const extensionId = tab.startsWith(PACKAGE_TAB_PREFIX) ? tab.slice(PACKAGE_TAB_PREFIX.length) : undefined;
  const scoped = extensionId ? rows.filter((r) => r.extensionId === extensionId) : rows;
  return fuzzyFilter(scoped, search, (row) =>
    [
      row.extensionId,
      row.extensionLabel,
      row.item.key,
      row.item.label,
      row.item.description ?? "",
      row.item.type,
      String(row.currentValue),
    ].join("\n"),
  );
}

export function saveSetting(row: SettingRow, newValue: unknown): void {
  setConfigKey(row.extensionId, row.item.key, newValue);
}

export function resetSetting(row: SettingRow): void {
  deleteConfigKey(row.extensionId, row.item.key);
}

export function resetExtensionSettings(rows: SettingRow[], extensionId: string): void {
  const extRows = rows.filter((r) => r.extensionId === extensionId);
  for (const r of extRows) {
    deleteConfigKey(extensionId, r.item.key);
  }
}

export function getSelectOptions(row: SettingRow) {
  if (row.item.type === "select") {
    return resolveOptions((row.item as SelectConfigItem).options);
  }
  if (row.item.type === "multiselect") {
    return resolveOptions((row.item as MultiSelectConfigItem).options);
  }
  if (row.item.type === "reorderable") {
    return resolveOptions((row.item as ReorderableConfigItem).options);
  }
  return [];
}

export function toggleMultiSelectValue(row: SettingRow, optionValue: unknown): unknown[] {
  const current = row.currentValue;
  const vals = Array.isArray(current) ? [...current] : [];
  const idx = vals.findIndex((v) => JSON.stringify(v) === JSON.stringify(optionValue));
  if (idx >= 0) {
    vals.splice(idx, 1);
  } else {
    vals.push(optionValue);
  }
  return vals;
}

export function toggleReorderableValue(row: SettingRow, optionValue: unknown): unknown[] {
  const current = row.currentValue;
  const vals = Array.isArray(current) ? [...current] : [];
  const idx = vals.findIndex((v) => JSON.stringify(v) === JSON.stringify(optionValue));
  if (idx >= 0) {
    vals.splice(idx, 1);
  } else {
    vals.push(optionValue);
  }
  return vals;
}

export function moveReorderableItem(row: SettingRow, fromIndex: number, direction: -1 | 1): unknown[] {
  const current = row.currentValue;
  const vals = Array.isArray(current) ? [...current] : [];
  const toIndex = fromIndex + direction;
  if (toIndex < 0 || toIndex >= vals.length) return vals;
  const [removed] = vals.splice(fromIndex, 1);
  vals.splice(toIndex, 0, removed!);
  return vals;
}

export interface SelectDisplayResult {
  options: ConfigItemSelectOption[];
  reorderableOrder: Map<string, number>;
  canFilter: boolean;
}

export function filterSelectOptions(options: ConfigItemSelectOption[], query: string): ConfigItemSelectOption[] {
  return fuzzyFilter(options, query, (opt) => opt.label);
}

export function buildSelectDisplayOptions(row: SettingRow, query: string): SelectDisplayResult {
  const opts: ConfigItemSelectOption[] = getSelectOptions(row);
  const canFilter = opts.length > 0 && opts.every((o) => typeof o.label === "string" && o.label.length > 0);

  if (row.item.type !== "reorderable") {
    return {
      options: filterSelectOptions(opts, query),
      reorderableOrder: new Map(),
      canFilter,
    };
  }

  const vals = Array.isArray(row.currentValue) ? row.currentValue : [];
  const selectedSet = new Set(vals.map((v) => JSON.stringify(v)));
  const optMap = new Map(opts.map((o) => [JSON.stringify(o.value), o]));
  const reorderableOrder = new Map<string, number>();
  vals.forEach((v, idx) => {
    const key = JSON.stringify(v);
    if (optMap.has(key)) reorderableOrder.set(key, idx + 1);
  });
  const selected = vals
    .map((v) => optMap.get(JSON.stringify(v)))
    .filter((o): o is ConfigItemSelectOption => o !== undefined);
  const unselected = opts.filter((o) => !selectedSet.has(JSON.stringify(o.value)));
  const ordered = [...selected, ...unselected];
  const matching = new Set(filterSelectOptions(ordered, query));

  return {
    options: ordered.filter((option) => matching.has(option)),
    reorderableOrder,
    canFilter,
  };
}

function isUnsetValue(value: unknown): boolean {
  return value === undefined || value === null;
}

function stringifyBoolean(value: boolean): string {
  return value ? "true" : "false";
}

export function stringifyValue(value: unknown): string {
  if (isUnsetValue(value)) return "";
  if (typeof value === "boolean") return stringifyBoolean(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
