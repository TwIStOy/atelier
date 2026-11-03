import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type {
  ConfigItem,
  ConfigItemPreviewHandle,
  MultiSelectConfigItem,
  ReorderableConfigItem,
  SelectConfigItem,
} from "@htwang-contrib/common";
import { buildSelectDisplayOptions } from "../config-registry.ts";
import type { InlineEditState, SelectingState, SettingRow } from "../types.ts";
import { SELECT_PAGE_SIZE } from "../types.ts";
import { divider, pad, wrapLine } from "./frame.ts";
import { glyphs } from "./glyphs.ts";

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isValidColor(value: string): boolean {
  return HEX_COLOR_RE.test(value.trim());
}

function colorFg(hex: string, text: string): string {
  const trimmed = hex.trim();
  let r: number, g: number, b: number;
  if (trimmed.length === 4) {
    r = parseInt(trimmed[1]! + trimmed[1], 16);
    g = parseInt(trimmed[2]! + trimmed[2], 16);
    b = parseInt(trimmed[3]! + trimmed[3], 16);
  } else {
    r = parseInt(trimmed.slice(1, 3), 16);
    g = parseInt(trimmed.slice(3, 5), 16);
    b = parseInt(trimmed.slice(5, 7), 16);
  }
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

function resolveItemOptions(item: SelectConfigItem | MultiSelectConfigItem | ReorderableConfigItem) {
  const raw = item.options;
  return typeof raw === "function" ? raw() : raw;
}

function formatSelectValue(item: ConfigItem, value: unknown): string {
  const opts = resolveItemOptions(item as SelectConfigItem);
  const matched = opts.find((o) => JSON.stringify(o.value) === JSON.stringify(value));
  return matched?.label ?? String(value);
}

function formatMultiSelectValue(item: ConfigItem, value: unknown): string {
  const opts = resolveItemOptions(item as MultiSelectConfigItem);
  const vals = value as unknown[];
  if (!Array.isArray(vals) || vals.length === 0) return "(none)";
  const labels = vals
    .map((v) => {
      const opt = opts.find((o) => JSON.stringify(o.value) === JSON.stringify(v));
      return opt?.label ?? String(v);
    })
    .join(", ");
  return truncateToWidth(labels, 40, "…");
}

function formatReorderableValue(item: ConfigItem, value: unknown): string {
  const opts = resolveItemOptions(item as ReorderableConfigItem);
  const vals = value as unknown[];
  if (!Array.isArray(vals) || vals.length === 0) return "(none)";
  const labels = vals
    .map((v, i) => {
      const opt = opts.find((o) => JSON.stringify(o.value) === JSON.stringify(v));
      return `${i + 1}. ${opt?.label ?? String(v)}`;
    })
    .join(", ");
  return truncateToWidth(labels, 50, "…");
}

type SettingValueFormatter = (item: ConfigItem, value: unknown, colorBlock?: string) => string;

const SETTING_VALUE_FORMATTERS: Record<string, SettingValueFormatter> = {
  boolean: (_item, value) => (value ? "true" : "false"),
  select: formatSelectValue,
  multiselect: formatMultiSelectValue,
  reorderable: formatReorderableValue,
  color: (_item, value, colorBlock) => `${colorBlock ?? "██"} ${String(value)}`,
};

function formatSettingValue(item: ConfigItem, value: unknown, colorBlock?: string): string {
  if (value === undefined || value === null) return "(unset)";
  if (item.secret) return "••••••";
  const formatter = SETTING_VALUE_FORMATTERS[item.type];
  return formatter ? formatter(item, value, colorBlock) : String(value);
}

function valueColor(
  theme: Theme,
  isEditing: boolean,
  isExplicit: boolean,
  isSelected: boolean,
): (text: string) => string {
  if (isEditing) return (t) => theme.fg("accent", t);
  if (isExplicit) return (t) => theme.fg("success", t);
  if (isSelected) return (t) => theme.fg("text", t);
  return (t) => theme.fg("muted", t);
}

export interface RenderedList {
  lines: string[];
  selectedVisible: boolean;
}

interface ListWalk {
  lines: string[];
  lastExtension: string;
  lastVisibleIndex: number;
  selectedVisible: boolean;
}

function rowColorBlock(row: SettingRow): string | undefined {
  if (row.item.type !== "color" || !isValidColor(String(row.currentValue))) return undefined;
  return colorFg(String(row.currentValue), "██");
}

function rowDisplayValue(row: SettingRow, isEditing: boolean, editing?: InlineEditState): string {
  if (isEditing && editing) return renderInlineEditValue(editing);
  return formatSettingValue(row.item, row.currentValue, rowColorBlock(row));
}

function renderSettingRowLine(
  row: SettingRow,
  isSelected: boolean,
  isEditing: boolean,
  editing: InlineEditState | undefined,
  width: number,
  theme: Theme,
): string {
  const labelText = row.item.label ?? row.item.key;
  const label = isSelected
    ? theme.fg("text", truncateToWidth(labelText, 34, "…"))
    : truncateToWidth(labelText, 34, "…");
  const displayValue = rowDisplayValue(row, isEditing, editing);
  const valueText = valueColor(theme, isEditing, row.isExplicit, isSelected)(displayValue);
  const itemPad = " ";
  const gap = Math.max(1, 36 - visibleWidth(labelText));
  const rowText = truncateToWidth(`${itemPad}${label}${" ".repeat(gap)}${valueText}`, width, "…");
  return isSelected ? theme.bg("selectedBg", pad(rowText, width)) : rowText;
}

function pushDescriptionLines(
  description: string,
  width: number,
  theme: Theme,
  lines: string[],
  contentBudget: number,
): void {
  for (const dl of wrapLine(description, Math.max(1, width - 4)).slice(0, 2)) {
    if (lines.length >= contentBudget) break;
    lines.push(theme.fg("muted", `    ${dl}`));
  }
}

function pushRow(
  row: SettingRow,
  isSelected: boolean,
  isEditing: boolean,
  editing: InlineEditState | undefined,
  walk: ListWalk,
  width: number,
  theme: Theme,
  contentBudget: number,
): void {
  walk.lines.push(renderSettingRowLine(row, isSelected, isEditing, editing, width, theme));
  if (!isSelected) return;
  walk.selectedVisible = true;
  if (!isEditing && row.item.description) {
    pushDescriptionLines(row.item.description, width, theme, walk.lines, contentBudget);
  }
}

function pushExtensionHeader(
  label: string,
  lastExtension: string,
  lines: string[],
  contentBudget: number,
  theme: Theme,
): boolean {
  if (lastExtension && lines.length < contentBudget) lines.push("");
  if (lines.length >= contentBudget) return false;
  lines.push(theme.fg("accent", theme.bold(label)));
  return true;
}

function maybePushHeader(row: SettingRow, walk: ListWalk, contentBudget: number, theme: Theme): boolean {
  if (row.extensionLabel === walk.lastExtension) return true;
  if (!pushExtensionHeader(row.extensionLabel, walk.lastExtension, walk.lines, contentBudget, theme)) return false;
  walk.lastExtension = row.extensionLabel;
  return true;
}

function appendRow(
  i: number,
  row: SettingRow,
  selected: number,
  editing: InlineEditState | undefined,
  walk: ListWalk,
  contentBudget: number,
  width: number,
  theme: Theme,
): boolean {
  if (walk.lines.length >= contentBudget) return false;
  const isSelected = i === selected;
  const isEditing = editing?.rowId === row.id;
  pushRow(row, isSelected, isEditing, editing, walk, width, theme, contentBudget);
  walk.lastVisibleIndex = i;
  return true;
}

function processRow(
  i: number,
  rows: SettingRow[],
  selected: number,
  editing: InlineEditState | undefined,
  walk: ListWalk,
  contentBudget: number,
  width: number,
  theme: Theme,
): boolean {
  if (walk.lines.length >= contentBudget) return false;
  if (!maybePushHeader(rows[i]!, walk, contentBudget, theme)) return false;
  return appendRow(i, rows[i]!, selected, editing, walk, contentBudget, width, theme);
}

function pushScrollIndicatorLines(
  moreBefore: string,
  moreAfter: string,
  lines: string[],
  budget: number,
  theme: Theme,
): void {
  lines.push("");
  if (lines.length < budget) {
    lines.push(theme.fg("dim", [moreBefore, moreAfter].filter(Boolean).join(glyphs().dot)));
  }
}

function initWalk(rows: SettingRow[], scroll: number, lines: string[]): ListWalk {
  return {
    lines,
    lastExtension: scroll > 0 ? (rows[scroll - 1]?.extensionLabel ?? "") : "",
    lastVisibleIndex: scroll - 1,
    selectedVisible: false,
  };
}

export function renderSettingList(
  rows: SettingRow[],
  selected: number,
  scroll: number,
  maxLines: number,
  width: number,
  theme: Theme,
  editing?: InlineEditState,
): RenderedList {
  const lines: string[] = [];
  const budget = Math.max(1, maxLines);
  const indicatorReserve = 2;
  const contentBudget = Math.max(1, budget - indicatorReserve);

  if (rows.length === 0) {
    lines.push(theme.fg("muted", "No matching settings."));
    return { lines, selectedVisible: false };
  }

  const walk = initWalk(rows, scroll, lines);

  for (let i = scroll; i < rows.length; i++) {
    if (!processRow(i, rows, selected, editing, walk, contentBudget, width, theme)) break;
  }

  const moreBefore = scroll > 0 ? `↑ ${scroll}` : "";
  const moreAfter = walk.lastVisibleIndex < rows.length - 1 ? `↓ ${rows.length - 1 - walk.lastVisibleIndex}` : "";
  if ((moreBefore || moreAfter) && lines.length < budget) {
    pushScrollIndicatorLines(moreBefore, moreAfter, lines, budget, theme);
  }

  return { lines, selectedVisible: walk.selectedVisible };
}

function pushSelectHeader(row: SettingRow, lines: string[], safeWidth: number, theme: Theme): void {
  lines.push(truncateToWidth(theme.fg("accent", theme.bold(`  ${row.item.label ?? row.item.key}`)), safeWidth, "…"));
  const desc = row.item.description;
  if (desc) {
    for (const dl of wrapLine(`    ${desc}`, safeWidth)) {
      lines.push(theme.fg("muted", dl));
    }
  }
  lines.push("");
}

function selectedValuesFor(row: SettingRow): unknown[] | undefined {
  if (row.item.type === "reorderable") {
    return Array.isArray(row.currentValue) ? (row.currentValue as unknown[]) : [];
  }
  return row.item.type === "multiselect" ? (row.currentValue as unknown[]) : undefined;
}

function isValueChecked(selectedValues: unknown[] | undefined, value: unknown): boolean {
  return Array.isArray(selectedValues) && selectedValues.some((v) => JSON.stringify(v) === JSON.stringify(value));
}

function renderSelectOption(
  opt: { label: string; value: unknown },
  row: SettingRow,
  isSelected: boolean,
  safeWidth: number,
  theme: Theme,
): string {
  const isCurrent = JSON.stringify(opt.value) === JSON.stringify(row.currentValue);
  const marker = isCurrent ? "●" : "○";
  return renderOptionLine(`  ${marker} ${opt.label}`, isSelected, safeWidth, theme);
}

function reorderableNumStr(orderNum: number): string {
  return orderNum > 0 ? `${`${orderNum}.`.padStart(3)} ` : "    ";
}

function reorderGlyph(isSelected: boolean, isChecked: boolean): string {
  return isSelected && isChecked ? " ↕" : "  ";
}

function renderReorderableOption(
  opt: { label: string; value: unknown },
  isSelected: boolean,
  selectedValues: unknown[] | undefined,
  reorderableOrder: Map<string, number>,
  safeWidth: number,
  theme: Theme,
): string {
  const isChecked = isValueChecked(selectedValues, opt.value);
  const checkMarker = isChecked ? "\uDB80\uDD35" : "\uDB80\uDD31";
  const numStr = reorderableNumStr(reorderableOrder.get(JSON.stringify(opt.value)) ?? 0);
  const content = `  ${checkMarker} ${numStr}${opt.label}${reorderGlyph(isSelected, isChecked)}`;
  return renderOptionLine(content, isSelected, safeWidth, theme);
}

function renderMultiSelectOption(
  opt: { label: string; value: unknown },
  isSelected: boolean,
  selectedValues: unknown[] | undefined,
  safeWidth: number,
  theme: Theme,
): string {
  const marker = isValueChecked(selectedValues, opt.value) ? "\uDB80\uDD35" : "\uDB80\uDD31";
  return renderOptionLine(`  ${marker} ${opt.label}`, isSelected, safeWidth, theme);
}

function renderSelectPageOption(
  opt: { label: string; value: unknown },
  i: number,
  row: SettingRow,
  selecting: SelectingState,
  selectedValues: unknown[] | undefined,
  reorderableOrder: Map<string, number>,
  safeWidth: number,
  theme: Theme,
): string {
  const isSelected = i === selecting.selectedOptionIndex;
  if (row.item.type === "select") return renderSelectOption(opt, row, isSelected, safeWidth, theme);
  if (row.item.type === "reorderable") {
    return renderReorderableOption(opt, isSelected, selectedValues, reorderableOrder, safeWidth, theme);
  }
  return renderMultiSelectOption(opt, isSelected, selectedValues, safeWidth, theme);
}

function pushPreviewLines(preview: ConfigItemPreviewHandle, lines: string[], safeWidth: number, theme: Theme): void {
  const previewLines = preview.render(safeWidth, theme);
  if (previewLines.length === 0) return;
  lines.push("");
  lines.push(divider(safeWidth, theme));
  lines.push(...previewLines);
}

export function renderSelectPage(
  row: SettingRow,
  selecting: SelectingState,
  width: number,
  theme: Theme,
  preview?: ConfigItemPreviewHandle,
): string[] {
  const safeWidth = Math.max(1, width);
  const lines: string[] = [];
  pushSelectHeader(row, lines, safeWidth, theme);

  const { options: displayOpts, reorderableOrder, canFilter } = buildSelectDisplayOptions(row, selecting.filter);

  if (canFilter) {
    lines.push(renderSelectSearchBar(selecting.filter, safeWidth, theme));
    lines.push("");
  }

  const selectedValues = selectedValuesFor(row);
  const pageSize = SELECT_PAGE_SIZE;
  const scrollStart = selecting.scroll;
  const scrollEnd = Math.min(scrollStart + pageSize, displayOpts.length);

  if (scrollStart > 0) {
    lines.push(truncateToWidth(theme.fg("dim", `  ↑ ${scrollStart} more above`), safeWidth, ""));
  }

  if (displayOpts.length === 0) {
    lines.push(theme.fg("muted", "  No matching options."));
  }

  for (let i = scrollStart; i < scrollEnd; i++) {
    lines.push(
      renderSelectPageOption(displayOpts[i]!, i, row, selecting, selectedValues, reorderableOrder, safeWidth, theme),
    );
  }

  if (scrollEnd < displayOpts.length) {
    lines.push(truncateToWidth(theme.fg("dim", `  ↓ ${displayOpts.length - scrollEnd} more below`), safeWidth, ""));
  }

  if (preview) pushPreviewLines(preview, lines, safeWidth, theme);

  return lines;
}

function renderOptionLine(content: string, isSelected: boolean, width: number, theme: Theme): string {
  const safeWidth = Math.max(1, width);
  const body = isSelected ? theme.fg("text", content) : content;
  const truncated = truncateToWidth(body, safeWidth, "…");
  if (isSelected) return theme.bg("selectedBg", pad(truncated, safeWidth));
  return truncated;
}

function renderSelectSearchBar(search: string, width: number, theme: Theme): string {
  const cursor = theme.inverse(" ");
  const text = ` ${theme.fg("dim", ">")} ${search}${cursor}`;
  return theme.bg("toolPendingBg", pad(text, width));
}

function renderInlineEditValue(editing: InlineEditState): string {
  const cursor = Math.max(0, Math.min(editing.cursor, editing.buffer.length));
  return `${editing.buffer.slice(0, cursor)}█${editing.buffer.slice(cursor)}`;
}
