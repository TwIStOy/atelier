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

export function formatSettingValue(item: ConfigItem, value: unknown): string {
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
    case "color":
      return String(value);
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

    const displayValue =
      isEditing && editing
        ? renderInlineEditValue(editing)
        : formatSettingValue(row.item, row.currentValue);

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
