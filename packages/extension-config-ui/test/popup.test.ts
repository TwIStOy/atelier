import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { clearConfigItems, readRawConfig, registerConfigItems } from "@htwang-contrib/common";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { computeLayout, openConfigPopup } from "../src/popup.ts";
import { DEFAULT_MAX_HEIGHT_PCT } from "../src/types.ts";

const ABSOLUTE_CAP = 26;

function typeText(component: Component, text: string): void {
  for (const char of text) component.handleInput?.(char);
}

function pressKey(component: Component, key: string): void {
  component.handleInput?.(key);
}

function renderedText(component: Component): string {
  return component.render(90).join("\n");
}

describe("computeLayout", () => {
  test("bodyRows never exceeds the max-height percentage of the terminal", () => {
    for (let rows = 20; rows <= 120; rows += 1) {
      const layout = computeLayout(rows);
      const maxHeight = Math.floor((rows * DEFAULT_MAX_HEIGHT_PCT) / 100);
      expect(layout.bodyRows).toBeLessThanOrEqual(maxHeight);
    }
  });

  test("bodyRows is capped by the absolute ceiling on very tall terminals", () => {
    expect(computeLayout(200).bodyRows).toBe(ABSOLUTE_CAP);
    expect(computeLayout(1000).bodyRows).toBe(ABSOLUTE_CAP);
  });

  test("bodyRows respects the minimum floor on tiny terminals", () => {
    expect(computeLayout(4).bodyRows).toBe(8);
    expect(computeLayout(1).bodyRows).toBe(8);
  });

  test("a 50-row terminal yields a compact ~50% popup", () => {
    expect(computeLayout(50)).toMatchObject({ bodyRows: 25, listRows: 18 });
  });

  test("innerRows mirrors bodyRows", () => {
    const layout = computeLayout(44);
    expect(layout.innerRows).toBe(layout.bodyRows);
  });

  test("leaves a bottom margin so the popup title stays above the app footer", () => {
    for (let rows = 24; rows <= 80; rows += 4) {
      const { bodyRows } = computeLayout(rows);
      expect(rows - bodyRows).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("model selection with fuzzy search", () => {
  const configId = "fuzzy-models-test";
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "config-fuzzy-test-"));
    vi.stubEnv("XDG_CONFIG_HOME", dir);
    registerConfigItems(configId, [
      {
        key: "summaryModel",
        type: "select",
        label: "Summary Model",
        value: "",
        options: [
          { label: "Current session", value: "" },
          { label: "toori/gpt-6", value: "toori/gpt-6" },
          { label: "toori/deepseek-v4.1-flash", value: "toori/deepseek-v4.1-flash" },
          { label: "other/deepseek-v4.1-flash", value: "other/deepseek-v4.1-flash" },
        ],
      },
    ]);
  });

  afterEach(() => {
    clearConfigItems(configId);
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  test("typing filters settings and model options, then saves the displayed match", async () => {
    const theme = {
      fg: (_color: string, text: string) => text,
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      inverse: (text: string) => text,
    } as Theme;
    const ctx = {
      ui: {
        notify: vi.fn(),
        custom: async (
          factory: (tui: TUI, theme: Theme, kb: unknown, done: () => void) => Component | Promise<Component>,
        ) => {
          const tui = { terminal: { rows: 50 }, requestRender: vi.fn() } as unknown as TUI;
          const component = await factory(tui, theme, {}, () => {});
          typeText(component, "summdl");
          expect(renderedText(component)).toContain("Summary Model");
          pressKey(component, "\r");
          typeText(component, "dsv4f toori");
          const rendered = renderedText(component);
          expect(rendered).toContain("toori/deepseek-v4.1-flash");
          expect(rendered).not.toContain("toori/gpt-6");
          expect(rendered).not.toContain("other/deepseek-v4.1-flash");
          pressKey(component, "\r");
          expect(readRawConfig(configId)?.summaryModel).toBe("toori/deepseek-v4.1-flash");
          pressKey(component, "\r");
          typeText(component, "no-match");
          expect(renderedText(component)).toContain("No matching options.");
          pressKey(component, "\r");
          expect(readRawConfig(configId)?.summaryModel).toBe("toori/deepseek-v4.1-flash");
          pressKey(component, "\x1b");
          pressKey(component, "\r");
          expect(readRawConfig(configId)?.summaryModel).toBe("");
        },
      },
    } as unknown as ExtensionContext;
    await openConfigPopup({} as ExtensionAPI, ctx);
  });
});
