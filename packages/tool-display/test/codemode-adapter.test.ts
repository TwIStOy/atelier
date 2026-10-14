import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { codemodeAdapter } from "../src/adapters/codemode.ts";

const theme: Theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

const CODE = `// @options: {"timeout_ms": 60000}
const files = await tools.glob({ pattern: "src/**/*.ts" });
const contents = await Promise.allSettled(files.map((f) => tools.read({ path: f })));
return contents.length;`;

const OUTPUT_OK = `Script completed
Wall time 2.4 seconds
Output:
42`;

const OUTPUT_FAILED = `Script failed
Wall time 1.1 seconds
Output:
partial result
Script error:
ReferenceError: nope is not defined
    at <anonymous> (script.js:2)

Tool calls made before the failure (they are not undone): read (ok)`;

function detailsWithCalls() {
  return {
    calls: [
      { name: "glob", args: '{"pattern":"src/**/*.ts"}', status: "ok", durationMs: 12 },
      { name: "read", args: '{"path":"a.ts"}', status: "running" },
      { name: "read", args: '{"path":"b.ts"}', status: "error", durationMs: 340, error: "file not found" },
    ],
  };
}

describe("codemodeAdapter.formatCallHeader", () => {
  it("shows the first meaningful script line as the label", () => {
    const header = codemodeAdapter.formatCallHeader({ code: CODE }, theme);
    expect(header).toContain("Codemode");
    expect(header).toContain("const files = await tools.glob");
    expect(header).not.toContain("@options");
  });

  it("shows settled/total call stats from details", () => {
    const header = codemodeAdapter.formatCallHeader({ code: CODE }, theme, detailsWithCalls(), true);
    expect(header).toContain("2/3 calls");
  });

  it("falls back to a placeholder when code is empty", () => {
    expect(codemodeAdapter.formatCallHeader({ code: "" }, theme)).toContain("…");
  });
});

describe("codemodeAdapter.formatCollapsedContent", () => {
  it("shows live call rows while running", () => {
    const lines = codemodeAdapter.formatCollapsedContent({ code: CODE }, "", theme, 100, detailsWithCalls(), true, 0);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("✓ glob");
    expect(lines[1]).toContain("read");
    expect(lines[2]).toContain("✗ read");
  });

  it("keeps the script output out of the collapsed view once finished", () => {
    const lines = codemodeAdapter.formatCollapsedContent({ code: CODE }, OUTPUT_OK, theme, 100, undefined, false);
    expect(lines.some((l) => l.includes("42"))).toBe(false);
    expect(lines.join("")).not.toContain("Script completed");
    expect(lines.join("")).not.toContain("Wall time");
  });

  it("shows the script error excerpt on failure", () => {
    const lines = codemodeAdapter.formatCollapsedContent({ code: CODE }, OUTPUT_FAILED, theme, 100, undefined, false);
    expect(lines.some((l) => l.includes("partial result"))).toBe(false);
    expect(lines.some((l) => l.includes("ReferenceError: nope is not defined"))).toBe(true);
    expect(lines.join("")).not.toContain("Script error:");
  });

  it("hints at earlier calls beyond the collapsed limit", () => {
    const calls = Array.from({ length: 12 }, (_, i) => ({ name: "read", args: `{"path":"f${i}.ts"}`, status: "ok" }));
    const lines = codemodeAdapter.formatCollapsedContent({ code: CODE }, "", theme, 100, { calls }, false, 0);
    expect(lines[0]).toContain("4 earlier calls");
    expect(lines.some((l) => l.includes("f11.ts"))).toBe(true);
    expect(lines.some((l) => l.includes("f3.ts"))).toBe(false);
  });

  it("shows the full output path when output was spilled", () => {
    const lines = codemodeAdapter.formatCollapsedContent(
      { code: CODE },
      OUTPUT_OK,
      theme,
      100,
      { fullOutputPath: "/tmp/pi-codemode-1.txt" },
      false,
    );
    expect(lines.some((l) => l.includes("Full output: /tmp/pi-codemode-1.txt"))).toBe(true);
  });

  it("sums model call costs when more than one call is priced", () => {
    const calls = [
      { name: "models.classify", status: "ok", cost: 0.001 },
      { name: "models.classify", status: "ok", cost: 0.002 },
    ];
    const lines = codemodeAdapter.formatCollapsedContent({ code: CODE }, "", theme, 100, { calls }, false, 0);
    expect(lines.some((l) => l.includes("Model calls: $0.0030"))).toBe(true);
  });
});

describe("codemodeAdapter.formatExpandedContent", () => {
  it("renders the full script with line numbers", () => {
    const lines = codemodeAdapter.formatExpandedContent({ code: CODE }, "", theme, 100);
    expect(lines.some((l) => l.includes("Promise.allSettled"))).toBe(true);
    expect(lines[0]).toMatch(/1 │/);
  });

  it("renders all calls with expanded error text", () => {
    const lines = codemodeAdapter.formatExpandedContent({ code: CODE }, "", theme, 100, detailsWithCalls());
    const sep = lines.findIndex((l) => l.includes("── calls ──"));
    expect(sep).toBeGreaterThan(0);
    expect(lines.slice(sep).some((l) => l.includes("file not found"))).toBe(true);
  });

  it("splits output and error sections", () => {
    const lines = codemodeAdapter.formatExpandedContent({ code: CODE }, OUTPUT_FAILED, theme, 100);
    const outputSep = lines.findIndex((l) => l.includes("── output ──"));
    const errorSep = lines.findIndex((l) => l.includes("── error ──"));
    expect(outputSep).toBeGreaterThan(0);
    expect(errorSep).toBeGreaterThan(outputSep);
    expect(lines[outputSep + 1]).toContain("partial result");
    expect(lines.slice(errorSep).some((l) => l.includes("ReferenceError"))).toBe(true);
  });
});
