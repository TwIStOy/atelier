import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type {
  ConfigItem,
  SelectConfigItem,
  MultiSelectConfigItem,
} from "@htwang-contrib/common";
import { glyphs } from "./glyphs.ts";
import { pad, wrapLine } from "./frame.ts";
import type { InlineEditState, SelectingState, SettingRow } from "../types.ts";

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidColor(value: string): boolean {
  return HEX_COLOR_RE.test(value.trim());
}

export function colorFg(hex: string, text: string): string {
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

export function formatSettingValue(
  item: ConfigItem,
  value: unknown,
  colorBlock?: string,
): string {
  if (value === undefined || value === null) return "(unset)";
  if (item.secret) return "••••••";
  switch (item.type) {
    case "boolean":
      return value ? "true" : "false";
    case "select": {
      const selectItem = item as SelectConfigItem;
      const matched = selectItem.options.find(
        (o) => JSON.stringify(o.value) === JSON.stringify(value),
      );
      return matched?.label ?? String(value);
    }
    case "multiselect": {
      const msItem = item as MultiSelectConfigItem;
      const vals = value as unknown[];
      if (!Array.isArray(vals) || vals.length === 0) return "(none)";
      const labels = vals
        .map((v) => {
          const opt = msItem.options.find(
            (o) => JSON.stringify(o.value) === JSON.stringify(v),
          );
          return opt?.label ?? String(v);
        })
        .join(", ");
      return truncateToWidth(labels, 40, "…");
    }
    case "color": {
      const block = colorBlock ?? "██";
      return `${block} ${String(value)}`;
    }
    case "number":
    case "string":
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

export function renderSettingList(
  rows: SettingRow[],
  selected: number,
  scroll: number,
  listRows: number,
  width: number,
  theme: Theme,
  editing?: InlineEditState,
): string[] {
  const lines: string[] = [];
  const visible = rows.slice(scroll, scroll + listRows);

  if (visible.length === 0) {
    lines.push(theme.fg("muted", "No matching settings."));
    return lines;
  }

  let lastExtension = "";

  for (const [visibleIndex, row] of visible.entries()) {
    const index = scroll + visibleIndex;
    const isSelected = index === selected;
    const isEditing = editing?.rowId === row.id;

    if (row.extensionLabel !== lastExtension) {
      if (lastExtension) lines.push("");
      lines.push(theme.fg("accent", theme.bold(row.extensionLabel)));
      lastExtension = row.extensionLabel;
    }

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

    const valueText = valueColor(
      theme,
      isEditing,
      row.isExplicit,
      isSelected,
    )(displayValue);

    const itemPad = " ";
    const gap = Math.max(1, 36 - visibleWidth(labelText));
    const rowText = truncateToWidth(
      `${itemPad}${label}${" ".repeat(gap)}${valueText}`,
      width,
      "…",
    );

    lines.push(
      isSelected ? theme.bg("selectedBg", pad(rowText, width)) : rowText,
    );

    if (isSelected && !isEditing && row.item.description) {
      const descLines = wrapLine(row.item.description, Math.max(1, width - 4));
      for (const dl of descLines.slice(0, 2)) {
        lines.push(theme.fg("muted", `    ${dl}`));
      }
    }
  }

  const moreBefore = scroll > 0 ? `↑ ${scroll}` : "";
  const moreAfter =
    scroll + listRows < rows.length
      ? `↓ ${rows.length - scroll - listRows}`
      : "";
  if (moreBefore || moreAfter) {
    lines.push("");
    lines.push(
      theme.fg(
        "dim",
        [moreBefore, moreAfter].filter(Boolean).join(glyphs().dot),
      ),
    );
  }

  return lines;
}

export function renderSelectPage(
  row: SettingRow,
  selecting: SelectingState,
  width: number,
  theme: Theme,
): string[] {
  const lines: string[] = [];
  lines.push(
    theme.fg("accent", theme.bold(`  ${row.item.label ?? row.item.key}`)),
  );

  const desc = row.item.description;
  if (desc) lines.push(theme.fg("muted", `    ${desc}`));
  lines.push("");

  if (row.item.type === "select") {
    const opts = (row.item as SelectConfigItem).options;
    for (let i = 0; i < opts.length; i++) {
      const isSelected = i === selecting.selectedOptionIndex;
      const isCurrent =
        JSON.stringify(opts[i]!.value) === JSON.stringify(row.currentValue);
      const marker = isCurrent ? "●" : "○";
      const label = isSelected
        ? theme.fg("text", `  ${marker} ${opts[i]!.label}`)
        : `  ${marker} ${opts[i]!.label}`;
      lines.push(
        isSelected ? theme.bg("selectedBg", pad(label, width)) : label,
      );
    }
  } else if (row.item.type === "multiselect") {
    const opts = (row.item as MultiSelectConfigItem).options;
    const selectedValues = row.currentValue as unknown[];
    for (let i = 0; i < opts.length; i++) {
      const isSelected = i === selecting.selectedOptionIndex;
      const isChecked =
        Array.isArray(selectedValues) &&
        selectedValues.some(
          (v) => JSON.stringify(v) === JSON.stringify(opts[i]!.value),
        );
      const marker = isChecked ? "\uDB80\uDD35" : "\uDB80\uDD31";
      const label = isSelected
        ? theme.fg("text", `  ${marker} ${opts[i]!.label}`)
        : `  ${marker} ${opts[i]!.label}`;
      lines.push(
        isSelected ? theme.bg("selectedBg", pad(label, width)) : label,
      );
    }
  }

  return lines;
}

function renderInlineEditValue(editing: InlineEditState): string {
  const cursor = Math.max(0, Math.min(editing.cursor, editing.buffer.length));
  return `${editing.buffer.slice(0, cursor)}█${editing.buffer.slice(cursor)}`;
}

export { renderInlineEditValue };
