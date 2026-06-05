import type {
  ConfigItem,
  ConfigItemRegistry,
  MultiSelectConfigItem,
  SelectConfigItem,
} from "@htwang-contrib/common";
import {
  getConfigItems,
  readConfig,
  updateConfig,
} from "@htwang-contrib/common";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SettingRow, TabDef } from "./types.ts";
import { TAB_ALL, PACKAGE_TAB_PREFIX } from "./types.ts";

function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg ? join(xdg, "pi") : join(homedir(), ".config", "pi");
  return join(base, "extensions.json");
}

function readRawSection(
  extensionId: string,
): Record<string, unknown> | undefined {
  try {
    if (!existsSync(configPath())) return undefined;
    const file = JSON.parse(readFileSync(configPath(), "utf8"));
    const section = file[extensionId];
    if (section && typeof section === "object" && !Array.isArray(section))
      return section as Record<string, unknown>;
    return undefined;
  } catch {
    return undefined;
  }
}

export function buildSettingRows(): SettingRow[] {
  const registries = getConfigItems() as ConfigItemRegistry[];
  const rows: SettingRow[] = [];

  for (const { extensionId, items } of registries) {
    const defaults = Object.fromEntries(
      items.map((i) => [i.key, i.defaultValue]),
    );
    const config = readConfig(extensionId, { defaults });
    const rawSection = readRawSection(extensionId);

    for (const item of items) {
      const rawValue = config[item.key as keyof typeof config];
      rows.push({
        id: `${extensionId}::${item.key}`,
        extensionId,
        extensionLabel: extensionId,
        item,
        currentValue: rawValue,
        isExplicit: rawSection ? item.key in rawSection : false,
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

export function filterRows(
  rows: SettingRow[],
  search: string,
  tab: string,
): SettingRow[] {
  const extensionId = tab.startsWith(PACKAGE_TAB_PREFIX)
    ? tab.slice(PACKAGE_TAB_PREFIX.length)
    : undefined;
  const scoped = extensionId
    ? rows.filter((r) => r.extensionId === extensionId)
    : rows;
  const query = search.trim().toLowerCase();
  if (!query) return scoped;
  return scoped.filter((row) => {
    const hay = [
      row.extensionId,
      row.extensionLabel,
      row.item.key,
      row.item.label,
      row.item.description ?? "",
      row.item.type,
      String(row.currentValue),
    ]
      .join("\n")
      .toLowerCase();
    return hay.includes(query);
  });
}

export function saveSetting(row: SettingRow, newValue: unknown): void {
  const defaults = Object.fromEntries([
    [row.item.key, row.item.defaultValue],
  ] as [string, unknown][]);
  updateConfig(row.extensionId, { defaults }, { [row.item.key]: newValue });
}

export function resetSetting(row: SettingRow): void {
  const defaults = Object.fromEntries([
    [row.item.key, row.item.defaultValue],
  ] as [string, unknown][]);
  updateConfig(
    row.extensionId,
    { defaults },
    {
      [row.item.key]: row.item.defaultValue,
    },
  );
}

export function resetExtensionSettings(
  rows: SettingRow[],
  extensionId: string,
): void {
  const extRows = rows.filter((r) => r.extensionId === extensionId);
  const defaults = Object.fromEntries(
    extRows.map((r) => [r.item.key, r.item.defaultValue] as [string, unknown]),
  );
  updateConfig(extensionId, { defaults }, defaults);
}

export function getSelectOptions(row: SettingRow) {
  if (row.item.type === "select") {
    return (row.item as SelectConfigItem).options;
  }
  if (row.item.type === "multiselect") {
    return (row.item as MultiSelectConfigItem).options;
  }
  return [];
}

export function toggleMultiSelectValue(
  row: SettingRow,
  optionValue: unknown,
): unknown[] {
  const current = row.currentValue;
  const vals = Array.isArray(current) ? [...current] : [];
  const idx = vals.findIndex(
    (v) => JSON.stringify(v) === JSON.stringify(optionValue),
  );
  if (idx >= 0) {
    vals.splice(idx, 1);
  } else {
    vals.push(optionValue);
  }
  return vals;
}

export function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
