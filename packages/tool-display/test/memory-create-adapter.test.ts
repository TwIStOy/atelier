import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { memoryCreateAdapter } from "../src/adapters/memory.ts";

initTheme("dark", false);

const theme: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

describe("memoryCreateAdapter", () => {
  it("inlines the created summary into the header by default", () => {
    const header = memoryCreateAdapter.formatCallHeader(
      { parent_uri: "core://agent", title: "notes", content: "line one\nline two" },
      theme,
      { parent_uri: "core://agent", content_preview: "line one\nline two", content_lines: 2 },
      false,
      false,
      120,
    );
    expect(header).toContain("Memory create");
    expect(header).toContain("core://agent");
    expect(header).toContain("→ notes");
    expect(header).toContain("created");
    expect(header).toContain("1 more");
  });

  it("falls back to args content when details are missing", () => {
    const header = memoryCreateAdapter.formatCallHeader(
      { parent_uri: "core://agent", content: "solo line" },
      theme,
      undefined,
      false,
      false,
      120,
    );
    expect(header).toContain("created");
    expect(header).toContain("solo line");
  });

  it("renders no collapsed body in the default single-line style", () => {
    const collapsed = memoryCreateAdapter.formatCollapsedContent({ parent_uri: "core://agent" }, "", theme, 120, {
      content_preview: "preview",
      content_lines: 3,
    });
    expect(collapsed).toEqual([]);
  });

  it("renders the full content when expanded", () => {
    const expanded = memoryCreateAdapter.formatExpandedContent(
      { parent_uri: "core://agent", content: "a\nb" },
      "",
      theme,
      80,
    );
    expect(expanded.join("\n")).toContain("a");
  });
});
