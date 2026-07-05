import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigItem } from "@htwang-contrib/common";
import { describe, expect, test } from "vitest";
import { renderSettingList } from "../src/render/setting-list.ts";
import type { SettingRow } from "../src/types.ts";

const PLAIN_THEME: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
  inverse: (text: string) => text,
} as Theme;

function booleanItem(key: string, label: string, description?: string): ConfigItem {
  return { type: "boolean", key, label, value: false, description } as ConfigItem;
}

function row(ext: string, item: ConfigItem): SettingRow {
  return {
    id: `${ext}::${item.key}`,
    extensionId: ext,
    extensionLabel: ext,
    item,
    currentValue: false,
    isExplicit: false,
  };
}

function buildRows(): SettingRow[] {
  const rows: SettingRow[] = [];
  for (let e = 0; e < 5; e += 1) {
    for (let i = 0; i < 3; i += 1) {
      const desc = e === 2 && i === 1 ? "selected row description that may wrap" : undefined;
      rows.push(row(`ext${e}`, booleanItem(`k${e}_${i}`, `Label ${e}/${i}`, desc)));
    }
  }
  return rows;
}

describe("renderSettingList physical-line budget", () => {
  const rows = buildRows();
  const selected = 7;

  test("never exceeds the physical line budget, even with group headers + description", () => {
    for (const maxLines of [6, 8, 12, 20, 40]) {
      const result = renderSettingList(rows, selected, 0, maxLines, 80, PLAIN_THEME);
      expect(result.lines.length).toBeLessThanOrEqual(maxLines);
    }
  });

  test("emits group headers and the selected description when budget allows", () => {
    const result = renderSettingList(rows, selected, 0, 40, 80, PLAIN_THEME);
    expect(result.lines.join("\n")).toContain("ext0");
    expect(result.lines.join("\n")).toContain("selected row description");
  });

  test("reports selectedVisible=true when the selected row fits in the budget", () => {
    const result = renderSettingList(rows, selected, 0, 40, 80, PLAIN_THEME);
    expect(result.selectedVisible).toBe(true);
  });

  test("reports selectedVisible=false when scroll pushes the selected row off-screen", () => {
    const result = renderSettingList(rows, selected, 12, 40, 80, PLAIN_THEME);
    expect(result.selectedVisible).toBe(false);
  });

  test("empty row list returns the empty-state line within budget", () => {
    const result = renderSettingList([], 0, 0, 10, 80, PLAIN_THEME);
    expect(result.lines).toHaveLength(1);
    expect(result.selectedVisible).toBe(false);
  });
});
