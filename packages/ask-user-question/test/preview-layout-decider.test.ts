import { describe, expect, it } from "vitest";
import type { QuestionData } from "../src/tool/types.ts";
import {
  crossTabLeftWidthWithDonation,
  crossTabMaxLeftWidth,
  crossTabPreviewBudget,
  MAX_LEFT_RATIO,
  MIN_LEFT,
  MIN_PREVIEW_WIDTH,
  PREVIEW_COLUMN_GAP,
} from "../src/view/components/preview/preview-layout-decider.ts";
import type { WrappingSelectItem } from "../src/view/components/wrapping-select.ts";

const opt = (label: string): WrappingSelectItem => ({ kind: "option", label });

const question = (options: Array<{ label: string; preview?: string }>, multiSelect?: boolean): QuestionData => ({
  question: "Test?",
  header: "Test",
  options: options.map((o) => ({ label: o.label, description: "", preview: o.preview })),
  ...(multiSelect !== undefined ? { multiSelect } : {}),
});

describe("crossTabPreviewBudget", () => {
  const OVERHEAD = 5; // BORDER_HORIZONTAL_OVERHEAD(2) + 2*BORDER_INNER_PADDING_HORIZONTAL(2) + PREVIEW_PADDING_LEFT(1)

  it("floors at MIN_PREVIEW_WIDTH when no question has previews", () => {
    const qs = [question([{ label: "A" }]), question([{ label: "B" }])];
    expect(crossTabPreviewBudget(qs, 120)).toBe(MIN_PREVIEW_WIDTH);
  });

  it("returns preview content width + overhead when previews are present", () => {
    const qs = [question([{ label: "A", preview: "x".repeat(50) }])];
    expect(crossTabPreviewBudget(qs, 200)).toBe(50 + OVERHEAD);
  });

  it("takes the max across all questions", () => {
    const qs = [question([{ label: "A", preview: "short" }]), question([{ label: "B", preview: "x".repeat(80) }])];
    expect(crossTabPreviewBudget(qs, 200)).toBe(80 + OVERHEAD);
  });

  it("ceilings at paneWidth - GAP - MIN_LEFT", () => {
    const qs = [question([{ label: "A", preview: "x".repeat(200) }])];
    const maxContent = 120 - PREVIEW_COLUMN_GAP - MIN_LEFT;
    expect(crossTabPreviewBudget(qs, 120)).toBe(maxContent + OVERHEAD);
  });
});

describe("crossTabLeftWidthWithDonation", () => {
  // 26-char label -> labelDriven = 26 + 5 (prefix) + 2 (confirmed) = 33 > MIN_LEFT(30).
  const LONG_LABEL = "Verbose Descriptive Option";

  it("short labels still donate newly available width", () => {
    const tabs = [{ multiSelect: false }];
    const itemsByTab = [[opt("npm"), opt("yarn")]];
    const qs = [
      question([
        { label: "npm", preview: "npm install" },
        { label: "yarn", preview: "yarn install" },
      ]),
    ];
    const labelDriven = crossTabMaxLeftWidth(tabs, itemsByTab, 200);
    expect(labelDriven).toBe(MIN_LEFT);
    expect(crossTabLeftWidthWithDonation(tabs, itemsByTab, qs, 200)).toBe(Math.floor(200 * MAX_LEFT_RATIO));
  });

  it("donation uses the tighter of the ratio and preview-safety ceilings", () => {
    const tabs = [{ multiSelect: false }];
    const itemsByTab = [[opt(LONG_LABEL), opt("B")]];
    const qs = [question([{ label: LONG_LABEL }, { label: "B" }])];
    const labelDriven = crossTabMaxLeftWidth(tabs, itemsByTab, 120);
    expect(labelDriven).toBeGreaterThan(MIN_LEFT);
    const result = crossTabLeftWidthWithDonation(tabs, itemsByTab, qs, 120);
    const previewSafetyCeiling = 120 - PREVIEW_COLUMN_GAP - MIN_PREVIEW_WIDTH;
    const ratioCeiling = Math.floor(120 * MAX_LEFT_RATIO);
    expect(result).toBe(Math.min(previewSafetyCeiling, ratioCeiling));
  });

  it("long labels + narrow previews -> slack donation engaged", () => {
    const tabs = [{ multiSelect: false }];
    const itemsByTab = [[opt(LONG_LABEL), opt("B")]];
    const qs = [question([{ label: LONG_LABEL, preview: "tiny" }, { label: "B" }])];
    const labelDriven = crossTabMaxLeftWidth(tabs, itemsByTab, 120);
    const donated = crossTabLeftWidthWithDonation(tabs, itemsByTab, qs, 120);
    expect(donated).toBeGreaterThan(labelDriven);
  });

  it("long labels + any wide preview -> reverts to label-driven (donation suppressed)", () => {
    const tabs = [{ multiSelect: false }];
    const itemsByTab = [[opt(LONG_LABEL), opt("B")]];
    const qs = [question([{ label: LONG_LABEL, preview: "x".repeat(100) }])];
    const labelDriven = crossTabMaxLeftWidth(tabs, itemsByTab, 120);
    expect(crossTabLeftWidthWithDonation(tabs, itemsByTab, qs, 120)).toBe(labelDriven);
  });

  it("any wide preview anywhere suppresses donation across all tabs", () => {
    const tabs = [{ multiSelect: false }, { multiSelect: false }];
    const itemsByTab = [[opt(LONG_LABEL)], [opt("B")]];
    const qs = [
      question([{ label: LONG_LABEL, preview: "tiny" }]),
      question([{ label: "B", preview: "x".repeat(100) }]),
    ];
    const labelDriven = crossTabMaxLeftWidth(tabs, itemsByTab, 120);
    expect(crossTabLeftWidthWithDonation(tabs, itemsByTab, qs, 120)).toBe(labelDriven);
  });

  it("respects MIN_PREVIEW_WIDTH ceiling - right column never below MIN_PREVIEW_WIDTH when donating", () => {
    const tabs = [{ multiSelect: false }];
    const itemsByTab = [[opt(LONG_LABEL), opt("B")]];
    const qs = [question([{ label: LONG_LABEL, preview: "tiny" }])];
    const result = crossTabLeftWidthWithDonation(tabs, itemsByTab, qs, 120);
    const rightWidth = 120 - result - PREVIEW_COLUMN_GAP;
    expect(rightWidth).toBeGreaterThanOrEqual(MIN_PREVIEW_WIDTH);
  });

  it("respects MAX_LEFT_RATIO ceiling - left column never exceeds half the pane when donating", () => {
    const tabs = [{ multiSelect: false }];
    const itemsByTab = [[opt("npm"), opt("yarn")]];
    const qs = [
      question([
        { label: "npm", preview: "npm install" },
        { label: "yarn", preview: "yarn install" },
      ]),
    ];
    const result = crossTabLeftWidthWithDonation(tabs, itemsByTab, qs, 200);
    expect(result).toBeLessThanOrEqual(Math.floor(200 * MAX_LEFT_RATIO));
  });

  it("floors at MIN_LEFT even with donation", () => {
    const tabs = [{ multiSelect: false }];
    const itemsByTab = [[opt(LONG_LABEL)]];
    const qs = [question([{ label: LONG_LABEL, preview: "tiny" }])];
    expect(crossTabLeftWidthWithDonation(tabs, itemsByTab, qs, 200)).toBeGreaterThanOrEqual(MIN_LEFT);
  });

  it("is deterministic - same args always produce same result", () => {
    const tabs = [{ multiSelect: false }];
    const itemsByTab = [[opt("A"), opt("B")]];
    const qs = [question([{ label: "A", preview: "medium content" }])];
    const first = crossTabLeftWidthWithDonation(tabs, itemsByTab, qs, 120);
    const second = crossTabLeftWidthWithDonation(tabs, itemsByTab, qs, 120);
    expect(first).toBe(second);
  });
});
