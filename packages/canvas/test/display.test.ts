import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { canvasPublishAdapter } from "../src/display.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const HTML = ["<!DOCTYPE html>", "<html><head><title>t</title></head>", "<body><h1>dashboard</h1></body></html>"].join(
  "\n",
);

describe("canvasPublishAdapter", () => {
  it("header shows the page name, never the html", () => {
    const header = canvasPublishAdapter.formatCallHeader({ name: "dash", html: HTML }, theme);
    expect(header).toBe("Canvas Publish dash");
    expect(header).not.toContain("<html");
    expect(header).not.toContain("DOCTYPE");
  });

  it("header falls back to the title when name is missing", () => {
    expect(canvasPublishAdapter.formatCallHeader({ html: HTML }, theme)).toBe("Canvas Publish");
  });

  it("collapsed content shows size and the publish url, not the html", () => {
    const output = 'Published "dash".\nhttp://127.0.0.1:7700/p/dash\nhttp://10.0.0.1:7700/p/dash';
    const lines = canvasPublishAdapter.formatCollapsedContent({ name: "dash", html: HTML }, output, theme, 80);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("http://127.0.0.1:7700/p/dash");
    expect(lines[0]).toMatch(/\d+\s*B/);
    expect(lines[0]).not.toContain("<html");
  });

  it("collapsed content is empty when there is no html and no url", () => {
    expect(canvasPublishAdapter.formatCollapsedContent({}, "", theme, 80)).toEqual([]);
  });

  it("expanded content renders the html body", () => {
    const lines = canvasPublishAdapter.formatExpandedContent({ name: "dash", html: HTML }, "", theme, 80);
    expect(lines.some((l) => l.includes("<html"))).toBe(true);
    expect(lines.some((l) => l.includes("<h1>dashboard</h1>"))).toBe(true);
  });

  it("expanded content shows an empty marker when html is absent", () => {
    const lines = canvasPublishAdapter.formatExpandedContent({}, "", theme, 80);
    expect(lines).toEqual(["    empty"]);
  });
});
