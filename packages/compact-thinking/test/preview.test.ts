import { describe, expect, it } from "vitest";
import { StrictThinkingPreview } from "../src/preview.ts";

const identity = (text: string): string => text;

function makePreview(text = "line1\nline2\nline3\nline4\nline5", previewLines = 2): StrictThinkingPreview {
  return new StrictThinkingPreview("Thought for 3s", text, 3, identity, previewLines);
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
