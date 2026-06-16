import { describe, expect, test } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ConfigItem } from "@htwang-contrib/common";
import { renderSelectPage } from "./setting-list.ts";
import type { SelectingState, SettingRow } from "../types.ts";

const PLAIN_THEME: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
  inverse: (text: string) => text,
} as Theme;

function makeRow(item: ConfigItem, currentValue: unknown): SettingRow {
  return {
    id: `ext::${item.key}`,
    extensionId: "ext",
    extensionLabel: "Ext",
    item,
    currentValue,
    isExplicit: false,
  };
}

function makeSelecting(rowId: string, filter = ""): SelectingState {
  return {
    rowId,
    selectedOptionIndex: 0,
    scroll: 0,
    filter,
  };
}

const LONG_LABELS = [
  "gpt-4-turbo-preview-2024-04-09",
  "claude-3-opus-20240229-very-long-suffix",
  "gemini-1.5-pro-latest-with-extra-qualifiers",
];

function longLabelSelectItem(): ConfigItem {
  return {
    key: "model",
    type: "select",
    label: "Model",
    value: "v0",
    description:
      "Pick the upstream model. Some names are quite long and must truncate to fit the terminal width.",
    options: LONG_LABELS.map((label, i) => ({ label, value: `v${i}` })),
  };
}

describe("renderSelectPage — line width safety", () => {
  test("every line fits within a narrow terminal width", () => {
    const item = longLabelSelectItem();
    const row = makeRow(item, "v0");
    const width = 45;
    const lines = renderSelectPage(
      row,
      makeSelecting(row.id),
      width,
      PLAIN_THEME,
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  test("fits width when an option is selected (selectedBg padding path)", () => {
    const item = longLabelSelectItem();
    const row = makeRow(item, "v0");
    const selecting = makeSelecting(row.id);
    selecting.selectedOptionIndex = 1;
    const width = 40;
    const lines = renderSelectPage(row, selecting, width, PLAIN_THEME);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  test("fits width with a long search filter active", () => {
    const item = longLabelSelectItem();
    const row = makeRow(item, "v0");
    const selecting: SelectingState = {
      rowId: row.id,
      selectedOptionIndex: 0,
      scroll: 0,
      filter: "claude-3-opus-20240229-very-long-suffix",
    };
    const width = 45;
    const lines = renderSelectPage(row, selecting, width, PLAIN_THEME);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  test("multiselect with long labels fits width", () => {
    const item: ConfigItem = {
      key: "models",
      type: "multiselect",
      label: "Enabled Models",
      value: [],
      options: LONG_LABELS.map((label, i) => ({ label, value: `v${i}` })),
    };
    const row = makeRow(item, ["v1"]);
    const width = 38;
    const lines = renderSelectPage(
      row,
      makeSelecting(row.id),
      width,
      PLAIN_THEME,
    );
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  test("reorderable with long labels fits width (selected + reordered)", () => {
    const item: ConfigItem = {
      key: "queue",
      type: "reorderable",
      label: "Model Queue",
      value: [],
      options: LONG_LABELS.map((label, i) => ({ label, value: `v${i}` })),
    };
    const row = makeRow(item, ["v2", "v0"]);
    const selecting = makeSelecting(row.id);
    selecting.selectedOptionIndex = 0;
    const width = 42;
    const lines = renderSelectPage(row, selecting, width, PLAIN_THEME);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  test("very narrow width (10 cols) still fits for all option types", () => {
    for (const type of ["select", "multiselect", "reorderable"] as const) {
      const item: ConfigItem = {
        key: "k",
        type,
        label: "K",
        value: type === "select" ? "v0" : [],
        options: LONG_LABELS.map((label, i) => ({ label, value: `v${i}` })),
      } as ConfigItem;
      const row = makeRow(item, type === "select" ? "v0" : ["v1"]);
      const lines = renderSelectPage(
        row,
        makeSelecting(row.id),
        10,
        PLAIN_THEME,
      );
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(10);
      }
    }
  });
});
