import type { ConfigItem } from "@htwang-contrib/common";
import { describe, expect, test } from "vitest";
import { buildSelectDisplayOptions, filterSelectOptions } from "./config-registry.ts";
import type { SettingRow } from "./types.ts";

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

function makeOptions(labels: string[], prefix = "v"): { label: string; value: string }[] {
  return labels.map((label, i) => ({ label, value: `${prefix}${i}` }));
}

describe("filterSelectOptions", () => {
  test("returns all options when query is empty", () => {
    const opts = makeOptions(["Apple", "Banana", "Cherry"]);
    expect(filterSelectOptions(opts, "")).toHaveLength(3);
  });

  test("returns all options when query is whitespace", () => {
    const opts = makeOptions(["Apple", "Banana", "Cherry"]);
    expect(filterSelectOptions(opts, "   ")).toHaveLength(3);
  });

  test("filters case-insensitively by substring on label", () => {
    const opts = makeOptions(["Apple", "Banana", "Cherry", "Grape"]);
    const result = filterSelectOptions(opts, "AP");
    expect(result.map((o) => o.label)).toEqual(["Apple", "Grape"]);
  });

  test("does not match on value, only label", () => {
    const opts = [
      { label: "First", value: "hidden-v0" },
      { label: "Second", value: "v1" },
    ];
    const result = filterSelectOptions(opts, "v0");
    expect(result).toHaveLength(0);
  });
});

describe("buildSelectDisplayOptions — select", () => {
  const item: ConfigItem = {
    key: "color",
    type: "select",
    label: "Color",
    value: "v0",
    options: makeOptions(["Red", "Green", "Blue"]),
  };

  test("no filter returns all options in original order", () => {
    const row = makeRow(item, "v1");
    const { options, reorderableOrder, canFilter } = buildSelectDisplayOptions(row, "");
    expect(options.map((o) => o.label)).toEqual(["Red", "Green", "Blue"]);
    expect(reorderableOrder.size).toBe(0);
    expect(canFilter).toBe(true);
  });

  test("filter narrows options", () => {
    const row = makeRow(item, "v1");
    const { options } = buildSelectDisplayOptions(row, "ee");
    expect(options.map((o) => o.label)).toEqual(["Green"]);
  });

  test("empty result yields canFilter true but empty options", () => {
    const row = makeRow(item, "v1");
    const { options, canFilter } = buildSelectDisplayOptions(row, "zzz");
    expect(options).toHaveLength(0);
    expect(canFilter).toBe(true);
  });
});

describe("buildSelectDisplayOptions — multiselect", () => {
  const item: ConfigItem = {
    key: "tags",
    type: "multiselect",
    label: "Tags",
    value: [],
    options: makeOptions(["Alpha", "Beta", "Gamma", "Delta"]),
  };

  test("preserves option order regardless of selection", () => {
    const row = makeRow(item, ["v2", "v0"]);
    const { options, reorderableOrder } = buildSelectDisplayOptions(row, "");
    expect(options.map((o) => o.label)).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    expect(reorderableOrder.size).toBe(0);
  });

  test("filter applies to multiselect", () => {
    const row = makeRow(item, ["v0"]);
    const { options } = buildSelectDisplayOptions(row, "amm");
    expect(options.map((o) => o.label)).toEqual(["Gamma"]);
  });
});

describe("buildSelectDisplayOptions — reorderable", () => {
  const item: ConfigItem = {
    key: "queue",
    type: "reorderable",
    label: "Queue",
    value: [],
    options: makeOptions(["One", "Two", "Three", "Four"]),
  };

  test("selected items come first, preserving currentValue order", () => {
    const row = makeRow(item, ["v2", "v0"]);
    const { options, reorderableOrder } = buildSelectDisplayOptions(row, "");
    expect(options.map((o) => o.label)).toEqual(["Three", "One", "Two", "Four"]);
    expect(reorderableOrder.get(JSON.stringify("v2"))).toBe(1);
    expect(reorderableOrder.get(JSON.stringify("v0"))).toBe(2);
    expect(reorderableOrder.has(JSON.stringify("v1"))).toBe(false);
  });

  test("filter keeps selected-first ordering among matches", () => {
    const row = makeRow(item, ["v3", "v1"]);
    const { options, reorderableOrder } = buildSelectDisplayOptions(row, "o");
    expect(options.map((o) => o.label)).toEqual(["Four", "Two", "One"]);
    expect(reorderableOrder.get(JSON.stringify("v3"))).toBe(1);
    expect(reorderableOrder.get(JSON.stringify("v1"))).toBe(2);
  });

  test("empty currentValue shows all unselected", () => {
    const row = makeRow(item, []);
    const { options, reorderableOrder } = buildSelectDisplayOptions(row, "");
    expect(options.map((o) => o.label)).toEqual(["One", "Two", "Three", "Four"]);
    expect(reorderableOrder.size).toBe(0);
  });
});

describe("buildSelectDisplayOptions — canFilter edge cases", () => {
  test("canFilter is false when any option has empty label", () => {
    const item: ConfigItem = {
      key: "k",
      type: "select",
      label: "K",
      value: "v0",
      options: [
        { label: "Valid", value: "v0" },
        { label: "", value: "v1" },
      ],
    };
    const row = makeRow(item, "v0");
    const { canFilter } = buildSelectDisplayOptions(row, "");
    expect(canFilter).toBe(false);
  });

  test("canFilter is false when options is empty", () => {
    const item: ConfigItem = {
      key: "k",
      type: "select",
      label: "K",
      value: "",
      options: [],
    };
    const row = makeRow(item, "");
    const { canFilter } = buildSelectDisplayOptions(row, "");
    expect(canFilter).toBe(false);
  });
});
