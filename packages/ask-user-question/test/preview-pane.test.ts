import type { Theme } from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-tui", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  class FakeMarkdown {
    constructor(public text: string) {}
    render(width: number): string[] {
      return [`MD[${width}]:${this.text.slice(0, Math.max(0, width - 4))}`];
    }
    invalidate(): void {}
    setText(t: string): void {
      this.text = t;
    }
  }
  return { ...actual, Markdown: FakeMarkdown };
});

import type { PointerTarget } from "../src/state/pointer-target.ts";
import type { QuestionData } from "../src/tool/types.ts";
import { OptionListView } from "../src/view/components/option-list-view.ts";
import {
  adaptiveLeftWidth,
  crossTabLeftWidthWithDonation,
  MAX_LEFT_RATIO,
  MIN_LEFT,
  PREVIEW_MIN_WIDTH,
} from "../src/view/components/preview/preview-layout-decider.ts";
import { PreviewBlockRenderer, PreviewPane } from "../src/view/components/preview/preview-pane.ts";
import type { WrappingSelectItem } from "../src/view/components/wrapping-select.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  strikethrough: (text: string) => text,
} as unknown as Theme;

const selectTheme = {
  selectedText: (t: string) => t,
  description: (t: string) => t,
  scrollInfo: (t: string) => t,
};

const markdownTheme = {
  heading: (t: string) => t,
  link: (t: string) => t,
  linkUrl: (t: string) => t,
  code: (t: string) => t,
  codeBlock: (t: string) => t,
  codeBlockBorder: (t: string) => t,
  quote: (t: string) => t,
  quoteBorder: (t: string) => t,
  hr: (t: string) => t,
  listBullet: (t: string) => t,
  bold: (t: string) => t,
  italic: (t: string) => t,
  strikethrough: (t: string) => t,
  underline: (t: string) => t,
} as unknown as MarkdownTheme;

interface PaneHarness {
  pane: PreviewPane;
  optionListView: OptionListView;
  previewBlock: PreviewBlockRenderer;
  items: WrappingSelectItem[];
  picked: PointerTarget[];
}

function makePane(question: QuestionData, getWidth: () => number = () => 120): PaneHarness {
  const items: WrappingSelectItem[] = question.options.map((o) => ({
    kind: "option",
    label: o.label,
    description: o.description,
  }));
  const picked: PointerTarget[] = [];
  const optionListView = new OptionListView({ items, theme: selectTheme, onPick: (t) => picked.push(t) });
  const previewBlock = new PreviewBlockRenderer({ question, theme, markdownTheme });
  const pane = new PreviewPane({ question, getTerminalWidth: getWidth, optionListView, previewBlock });
  const totalForNumbering = question.multiSelect === true ? items.length : items.length + 1;
  pane.setGlobalLeftWidth((paneWidth) => adaptiveLeftWidth(items, totalForNumbering, paneWidth));
  return { pane, optionListView, previewBlock, items, picked };
}

const mdLine = (l: string) => /MD\[\d+\]:/.test(l);

describe("PreviewPane.render — layout switching", () => {
  const question: QuestionData = {
    question: "pick",
    header: "pick",
    options: [
      { label: "A", description: "", preview: "## A\n\nbody A content" },
      { label: "B", description: "", preview: "## B\n\nbody B content" },
      { label: "C", description: "" },
    ],
  };

  it("a resize from width 99 to 100 switches from stacked to right-aligned side-by-side", () => {
    let terminalWidth = 99;
    const view = makePane(question, () => terminalWidth);
    view.pane.setGlobalLeftWidth((w) =>
      crossTabLeftWidthWithDonation([{ multiSelect: false }], [view.items], [question], w),
    );
    view.optionListView.setProps({ selectedIndex: 0, focused: true, inputBuffer: "" });
    const narrowLines = view.pane.render(99);
    expect(narrowLines.findIndex(mdLine)).toBeGreaterThan(0);

    terminalWidth = PREVIEW_MIN_WIDTH;
    const wideLines = view.pane.render(PREVIEW_MIN_WIDTH);
    expect(wideLines.some(mdLine)).toBe(true);
    const previewTop = wideLines.find((line) => line.includes("┌"));
    expect(visibleWidth(previewTop ?? "")).toBe(PREVIEW_MIN_WIDTH);
  });
});

describe("PreviewPane — right-aligned preview with a bounded options column", () => {
  const question: QuestionData = {
    question: "pick",
    header: "pick",
    options: [
      { label: "A", description: "", preview: "short body" },
      { label: "B", description: "" },
    ],
  };

  function extractPreviewColumnLines(joined: string[]): string[] {
    return joined.filter(mdLine);
  }

  it("content-sized preview boxes share the right edge while retaining their natural widths", () => {
    const short = makePane(question, () => 120);
    short.optionListView.setProps({ selectedIndex: 0, focused: true, inputBuffer: "" });
    const shortLines = short.pane.render(120);
    const shortMD = extractPreviewColumnLines(shortLines)[0].indexOf("MD[");

    const longQ: QuestionData = {
      question: "pick",
      header: "pick",
      options: [
        { label: "A", description: "", preview: "x".repeat(500) },
        { label: "B", description: "" },
      ],
    };
    const long = makePane(longQ, () => 120);
    long.optionListView.setProps({ selectedIndex: 0, focused: true, inputBuffer: "" });
    const longLines = long.pane.render(120);
    const longMD = extractPreviewColumnLines(longLines)[0].indexOf("MD[");

    expect(visibleWidth(shortLines.find((line) => line.includes("┌")) ?? "")).toBe(120);
    expect(visibleWidth(longLines.find((line) => line.includes("┌")) ?? "")).toBe(120);
    expect(shortMD).toBeGreaterThan(longMD);
  });

  it("width safety: visibleWidth(line) <= width across boundary widths", () => {
    for (const w of [100, 120, 160]) {
      const { pane, optionListView } = makePane(question, () => w);
      optionListView.setProps({ selectedIndex: 0, focused: true, inputBuffer: "" });
      const lines = pane.render(w);
      for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(w);
    }
  });
});

describe("PreviewPane — slack donation to left column", () => {
  const LONG_LABEL = "Verbose Descriptive Option";

  it("short labels donate slack and move the preview to the right", () => {
    const compactQ: QuestionData = {
      question: "pick",
      header: "pick",
      options: [
        { label: "A", description: "", preview: "tiny" },
        { label: "B", description: "" },
      ],
    };
    const { pane, optionListView, items } = makePane(compactQ, () => 200);
    const tabs = [{ multiSelect: false }];
    const itemsByTab = [items];
    const questions = [compactQ];
    pane.setGlobalLeftWidth((w) => crossTabLeftWidthWithDonation(tabs, itemsByTab, questions, w));
    optionListView.setProps({ selectedIndex: 0, focused: true, inputBuffer: "" });

    const donatedLeft = crossTabLeftWidthWithDonation(tabs, itemsByTab, questions, 200);
    expect(donatedLeft).toBe(Math.floor(200 * MAX_LEFT_RATIO));

    const lines = pane.render(200);
    const previewTop = lines.find((line) => line.includes("┌"));
    expect(visibleWidth(previewTop ?? "")).toBe(200);
  });

  it("long labels + narrow previews -> donation engaged, box right-aligned and capped by ratio", () => {
    const narrowQ: QuestionData = {
      question: "pick",
      header: "pick",
      options: [
        { label: LONG_LABEL, description: "", preview: "tiny" },
        { label: "B", description: "" },
      ],
    };
    const { pane, optionListView, items } = makePane(narrowQ, () => 120);
    const tabs = [{ multiSelect: false }];
    const itemsByTab = [items];
    const questions = [narrowQ];
    pane.setGlobalLeftWidth((w) => crossTabLeftWidthWithDonation(tabs, itemsByTab, questions, w));
    optionListView.setProps({ selectedIndex: 0, focused: true, inputBuffer: "" });

    const labelDriven = adaptiveLeftWidth(items, 3, 120);
    expect(labelDriven).toBeGreaterThan(MIN_LEFT);

    const lines = pane.render(120);
    expect(lines.find(mdLine)).toBeDefined();
    // Donation wants 73 columns, but the 50% ratio caps the options column at 60.
    const donatedLeft = crossTabLeftWidthWithDonation(tabs, itemsByTab, questions, 120);
    expect(donatedLeft).toBe(Math.floor(120 * MAX_LEFT_RATIO));
    const previewTop = lines.find((line) => line.includes("┌"));
    expect(visibleWidth(previewTop ?? "")).toBe(120);
  });

  it("long labels + wide previews -> donation suppressed, box still spans the pane", () => {
    const wideQ: QuestionData = {
      question: "pick",
      header: "pick",
      options: [
        { label: LONG_LABEL, description: "", preview: "x".repeat(500) },
        { label: "B", description: "" },
      ],
    };
    const { pane, optionListView, items } = makePane(wideQ, () => 120);
    const tabs = [{ multiSelect: false }];
    const itemsByTab = [items];
    const questions = [wideQ];
    pane.setGlobalLeftWidth((w) => crossTabLeftWidthWithDonation(tabs, itemsByTab, questions, w));
    optionListView.setProps({ selectedIndex: 0, focused: true, inputBuffer: "" });

    const donatedLeft = crossTabLeftWidthWithDonation(tabs, itemsByTab, questions, 120);
    const labelDriven = adaptiveLeftWidth(items, 3, 120);
    expect(donatedLeft).toBe(labelDriven);

    const lines = pane.render(120);
    const previewTop = lines.find((line) => line.includes("┌"));
    expect(visibleWidth(previewTop ?? "")).toBe(120);
  });
});
