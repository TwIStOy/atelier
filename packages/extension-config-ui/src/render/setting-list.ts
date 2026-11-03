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

function formatSettingValue(item: ConfigItem, value: unknown, colorBlock?: string): string {
  if (value === undefined || value === null) return "(unset)";
  if (item.secret) return "••••••";
  switch (item.type) {
    case "boolean":
      return value ? "true" : "false";
    case "select": {
      const selectItem = item as SelectConfigItem;
      const opts = typeof selectItem.options === "function" ? selectItem.options() : selectItem.options;
      const matched = opts.find((o) => JSON.stringify(o.value) === JSON.stringify(value));
      return matched?.label ?? String(value);
    }
    case "multiselect": {
      const msItem = item as MultiSelectConfigItem;
      const opts = typeof msItem.options === "function" ? msItem.options() : msItem.options;
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
    case "reorderable": {
      const roItem = item as ReorderableConfigItem;
      const opts = typeof roItem.options === "function" ? roItem.options() : roItem.options;
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
    case "color": {
      const block = colorBlock ?? "██";
      return `${block} ${String(value)}`;
    }
    default:
      return String(value);
  }
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

  let lastExtension = scroll > 0 ? (rows[scroll - 1]?.extensionLabel ?? "") : "";
  let lastVisibleIndex = scroll - 1;
  let selectedVisible = false;

  for (let i = scroll; i < rows.length; i++) {
    if (lines.length >= contentBudget) break;
    const row = rows[i]!;
    const isSelected = i === selected;
    const isEditing = editing?.rowId === row.id;

    if (row.extensionLabel !== lastExtension) {
      if (lastExtension && lines.length < contentBudget) lines.push("");
      if (lines.length < contentBudget) {
        lines.push(theme.fg("accent", theme.bold(row.extensionLabel)));
      } else {
        break;
      }
      lastExtension = row.extensionLabel;
    }

    if (lines.length >= contentBudget) break;

    const labelText = row.item.label ?? row.item.key;
    const label = isSelected
      ? theme.fg("text", truncateToWidth(labelText, 34, "…"))
      : truncateToWidth(labelText, 34, "…");

    const colorBlock =
      row.item.type === "color" && isValidColor(String(row.currentValue))
        ? colorFg(String(row.currentValue), "██")
        : undefined;
    const displayValue =
      isEditing && editing
        ? renderInlineEditValue(editing)
        : formatSettingValue(row.item, row.currentValue, colorBlock);

    const valueText = valueColor(theme, isEditing, row.isExplicit, isSelected)(displayValue);

    const itemPad = " ";
    const gap = Math.max(1, 36 - visibleWidth(labelText));
    const rowText = truncateToWidth(`${itemPad}${label}${" ".repeat(gap)}${valueText}`, width, "…");

    lines.push(isSelected ? theme.bg("selectedBg", pad(rowText, width)) : rowText);
    lastVisibleIndex = i;
    if (isSelected) selectedVisible = true;

    if (isSelected && !isEditing && row.item.description) {
      const descLines = wrapLine(row.item.description, Math.max(1, width - 4)).slice(0, 2);
      for (const dl of descLines) {
        if (lines.length < contentBudget) lines.push(theme.fg("muted", `    ${dl}`));
        else break;
      }
    }
  }

  const moreBefore = scroll > 0 ? `↑ ${scroll}` : "";
  const moreAfter = lastVisibleIndex < rows.length - 1 ? `↓ ${rows.length - 1 - lastVisibleIndex}` : "";
  if ((moreBefore || moreAfter) && lines.length < budget) {
    lines.push("");
    if (lines.length < budget) {
      lines.push(theme.fg("dim", [moreBefore, moreAfter].filter(Boolean).join(glyphs().dot)));
    }
  }

  return { lines, selectedVisible };
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
  lines.push(truncateToWidth(theme.fg("accent", theme.bold(`  ${row.item.label ?? row.item.key}`)), safeWidth, "…"));

  const desc = row.item.description;
  if (desc) {
    for (const dl of wrapLine(`    ${desc}`, safeWidth)) {
      lines.push(theme.fg("muted", dl));
    }
  }
  lines.push("");

  const { options: displayOpts, reorderableOrder, canFilter } = buildSelectDisplayOptions(row, selecting.filter);

  if (canFilter) {
    lines.push(renderSelectSearchBar(selecting.filter, safeWidth, theme));
    lines.push("");
  }

  let selectedValues: unknown[] | undefined;

  if (row.item.type === "reorderable") {
    selectedValues = Array.isArray(row.currentValue) ? (row.currentValue as unknown[]) : [];
  } else {
    selectedValues = row.item.type === "multiselect" ? (row.currentValue as unknown[]) : undefined;
  }

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
    const opt = displayOpts[i]!;
    const isSelected = i === selecting.selectedOptionIndex;
    if (row.item.type === "select") {
      const isCurrent = JSON.stringify(opt.value) === JSON.stringify(row.currentValue);
      const marker = isCurrent ? "●" : "○";
      const content = `  ${marker} ${opt.label}`;
      lines.push(renderOptionLine(content, isSelected, safeWidth, theme));
    } else if (row.item.type === "reorderable") {
      const isChecked =
        Array.isArray(selectedValues) && selectedValues.some((v) => JSON.stringify(v) === JSON.stringify(opt.value));
      const checkMarker = isChecked ? "\uDB80\uDD35" : "\uDB80\uDD31";
      const orderNum = reorderableOrder.get(JSON.stringify(opt.value)) ?? 0;
      const numStr = orderNum > 0 ? `${`${orderNum}.`.padStart(3)} ` : "    ";
      const reorderGlyph = isSelected && isChecked ? " ↕" : "  ";
      const content = `  ${checkMarker} ${numStr}${opt.label}${reorderGlyph}`;
      lines.push(renderOptionLine(content, isSelected, safeWidth, theme));
    } else {
      const isChecked =
        Array.isArray(selectedValues) && selectedValues.some((v) => JSON.stringify(v) === JSON.stringify(opt.value));
      const marker = isChecked ? "\uDB80\uDD35" : "\uDB80\uDD31";
      const content = `  ${marker} ${opt.label}`;
      lines.push(renderOptionLine(content, isSelected, safeWidth, theme));
    }
  }

  if (scrollEnd < displayOpts.length) {
    lines.push(truncateToWidth(theme.fg("dim", `  ↓ ${displayOpts.length - scrollEnd} more below`), safeWidth, ""));
  }

  if (preview) {
    const previewLines = preview.render(safeWidth, theme);
    if (previewLines.length > 0) {
      lines.push("");
      lines.push(divider(safeWidth, theme));
      lines.push(...previewLines);
    }
  }

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
