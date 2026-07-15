import { describe, expect, test } from "vitest";
import { _parseSearchMarkdownForTest as parseSearchMarkdown } from "../src/providers/anysearch.ts";

const REAL_SEARCH_MARKDOWN = `## Search Results (2 results, 925ms)

### 1. Hello, world
- **URL**: https://en.wikipedia.org/wiki/Hello,_world
- Hello, world A "Hello, world" program is usually a simple computer program that displays on the screen (often the console) a message similar to "Hello, world".

### 2. Hello, World - CS50
- **URL**: https://cs50.harvard.edu/college/2026/spring/psets/1/world/
- Hello, World - CS50 This is Spring 2026 of CS50 at Harvard College.`;

describe("parseSearchMarkdown", () => {
  test("parses real AnySearch Markdown into structured results", () => {
    const results = parseSearchMarkdown(REAL_SEARCH_MARKDOWN);
    expect(results).toHaveLength(2);

    expect(results[0].title).toBe("Hello, world");
    expect(results[0].url).toBe("https://en.wikipedia.org/wiki/Hello,_world");
    expect(results[0].snippet).toContain("simple computer program");

    expect(results[1].title).toBe("Hello, World - CS50");
    expect(results[1].url).toBe("https://cs50.harvard.edu/college/2026/spring/psets/1/world/");
    expect(results[1].snippet).toContain("CS50 at Harvard College");
  });

  test("returns empty array for no-results marker", () => {
    const results = parseSearchMarkdown("## Search Results (0 results, 123ms)");
    expect(results).toEqual([]);
  });

  test("returns empty array for empty string", () => {
    expect(parseSearchMarkdown("")).toEqual([]);
  });

  test("falls back to structured JSON when response is a JSON array", () => {
    const json = JSON.stringify([
      { title: "T1", url: "https://a.com", snippet: "S1" },
      { title: "T2", url: "https://b.com", snippet: "S2" },
    ]);
    const results = parseSearchMarkdown(json);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: "T1", url: "https://a.com", snippet: "S1" });
    expect(results[1]).toEqual({ title: "T2", url: "https://b.com", snippet: "S2" });
  });

  test("extracts bare URL from title line when URL bullet is absent", () => {
    const md = `## Search Results (1 results, 5ms)

### 1. Example Site (https://example.com/page)
- Some snippet text here.`;
    const results = parseSearchMarkdown(md);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com/page");
    expect(results[0].snippet).toContain("Some snippet text");
  });

  test("parses multi-line snippets into joined text", () => {
    const md = `## Search Results (1 results, 5ms)

### 1. Title
- **URL**: https://example.com
- First line of snippet.
- Second line of snippet.`;
    const results = parseSearchMarkdown(md);
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe("First line of snippet. Second line of snippet.");
  });
});
