import { stripTerminalSequences, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { ActiveThinkingPreview, SingleLineText, StrictThinkingPreview } from "../src/preview.ts";

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

describe("ActiveThinkingPreview tail wrap", () => {
  const ansiStyle = (text: string): string => `\u001b[3m\u001b[38;2;200;200;200m${text}\u001b[0m\u001b[23m`;

  // Long source lines wrap into several visual lines, an interior empty line
  // simulates a block boundary, and the style emits real escape sequences so
  // ANSI state carrying across wrapped lines is exercised.
  const longText = [
    "first line that is long enough to wrap across multiple visual rows when the width is small",
    "",
    "b",
    "c",
    "last line that also wraps because it exceeds the narrow render width by far",
  ].join("\n");

  function fullWrapTail(text: string, previewLines: number, width: number): string[] {
    return wrapTextWithAnsiStyled(text, width).slice(-previewLines);
  }

  function wrapTextWithAnsiStyled(text: string, width: number): string[] {
    const wrapped = wrapTextWithAnsi(ansiStyle(text), width);
    return wrapped.map((line) => line + " ".repeat(Math.max(0, width - visibleWidth(line))));
  }

  it("renders the same tail as wrapping the full styled text", () => {
    for (const previewLines of [1, 2, 3, 5]) {
      const preview = new ActiveThinkingPreview("Thinking...", longText, previewLines, ansiStyle);
      const [heading, ...body] = preview.render(30);
      expect(stripTerminalSequences(heading)).toContain("Thinking...");
      expect(body).toEqual(fullWrapTail(longText, previewLines, 30));
    }
  });

  it("wraps the whole text when it has fewer lines than the preview budget", () => {
    const text = "only\ntwo";
    const preview = new ActiveThinkingPreview("Thinking...", text, 3, ansiStyle);
    const [, ...body] = preview.render(30);
    expect(body).toEqual(fullWrapTail(text, 3, 30));
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
