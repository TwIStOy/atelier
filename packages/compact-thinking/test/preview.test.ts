import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { SingleLineText, StrictThinkingPreview } from "../src/preview.ts";

const identity = (text: string): string => text;

function makePreview(text = "line1\nline2\nline3\nline4\nline5"): StrictThinkingPreview {
  return new StrictThinkingPreview("Thought for 3s", text, identity);
}

describe("StrictThinkingPreview render cache", () => {
  it("returns the cached array on repeated renders at the same width", () => {
    const preview = makePreview();
    const first = preview.render(80);
    const second = preview.render(80);
    expect(second).toBe(first);
  });

  it("re-renders when the width changes", () => {
    const preview = makePreview();
    const narrow = preview.render(20);
    const wide = preview.render(120);
    expect(wide).not.toBe(narrow);
    const narrowAgain = preview.render(20);
    expect(narrowAgain).not.toBe(narrow);
  });

  it("produces identical output for cached and uncached renders", () => {
    const a = makePreview().render(80);
    const b = makePreview();
    b.render(80);
    const cached = b.render(80);
    expect([...cached]).toEqual([...a]);
  });

  it("drops the cache on invalidate", () => {
    const preview = makePreview();
    const first = preview.render(80);
    preview.invalidate();
    const second = preview.render(80);
    expect(second).not.toBe(first);
    expect([...second]).toEqual([...first]);
  });
});

describe("StrictThinkingPreview expanded layout", () => {
  it("renders the heading with the collapse hint, a blank line, then the full text", () => {
    const rendered = makePreview()
      .render(80)
      .map((line) => line.replace(/[ \t]+$/, ""));
    expect(rendered[0]).toContain("Thought for 3s");
    expect(rendered[0]).toContain("(click to collapse)");
    expect(rendered[1]).toBe("");
    expect(rendered.slice(2)).toEqual(["line1", "line2", "line3", "line4", "line5"]);
  });

  it("keeps every text line, not just a trailing slice", () => {
    const text = Array.from({ length: 40 }, (_, i) => `l${i}`).join("\n");
    const rendered = makePreview(text).render(80);
    expect(rendered).toHaveLength(42);
    expect(rendered[2].trim()).toBe("l0");
    expect(rendered[rendered.length - 1].trim()).toBe("l39");
  });
});

describe("SingleLineText", () => {
  it("renders exactly one line at the given width", () => {
    const line = new SingleLineText("Thought for 5s — decided to refactor");
    expect(line.render(80)).toEqual(["Thought for 5s — decided to refactor"]);
  });

  it("truncates with an ellipsis instead of wrapping", () => {
    const line = new SingleLineText("Thought for 5s — a fairly long summary that will not fit");
    const rendered = line.render(30);
    expect(rendered).toHaveLength(1);
    expect(visibleWidth(rendered[0])).toBeLessThanOrEqual(30);
    expect(stripTerminalSequences(rendered[0]).endsWith("…")).toBe(true);
  });

  it("truncates styled text without breaking the visible width", () => {
    const styled = "\x1b[3mThought for 5s\x1b[23m — summary".padEnd(200, "x");
    const rendered = new SingleLineText(styled).render(24);
    expect(rendered).toHaveLength(1);
    expect(visibleWidth(rendered[0])).toBeLessThanOrEqual(24);
    expect(stripTerminalSequences(rendered[0]).endsWith("…")).toBe(true);
  });

  it("returns the same line for repeated renders", () => {
    const line = new SingleLineText("stable");
    expect(line.render(80)).toEqual(["stable"]);
    expect(line.render(80)).toEqual(["stable"]);
  });
});
