import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ApplyPatchToolDetails } from "@htwang-contrib/apply-patch/preview";
import { describe, expect, it } from "vitest";
import { applyPatchAdapter } from "../src/adapters/apply-patch.ts";

const identityTheme = {
  fg: (_name: string, text: string) => text,
  bg: (_name: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

const SINGLE_FILE_PATCH = `*** Begin Patch
*** Update File: src/app.ts
@@
-old
+new
*** End Patch`;

const MULTI_FILE_PATCH = `*** Begin Patch
*** Update File: src/app.ts
@@
-old
+new
*** Update File: src/util.ts
@@
-gone
*** End Patch`;

function previewDetails(overrides: Partial<ApplyPatchToolDetails> = {}): ApplyPatchToolDetails {
  return {
    preview: {
      files: [
        {
          filePath: "src/app.ts",
          operation: "update",
          diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
          added: 1,
          removed: 1,
        },
      ],
      added: 1,
      removed: 1,
    },
    ...overrides,
  };
}

describe("applyPatchAdapter.formatCallHeader", () => {
  it("shows the tool title with placeholder while streaming", () => {
    const header = applyPatchAdapter.formatCallHeader({ input: "*** Begin Patch\n" }, identityTheme);
    expect(header).toBe("ApplyPatch ...");
  });

  it("shows the first patched path", () => {
    const header = applyPatchAdapter.formatCallHeader({ input: SINGLE_FILE_PATCH }, identityTheme);
    expect(header).toBe("ApplyPatch src/app.ts");
  });

  it("shows remaining file count for multi-file patches", () => {
    const header = applyPatchAdapter.formatCallHeader({ input: MULTI_FILE_PATCH }, identityTheme);
    expect(header).toBe("ApplyPatch src/app.ts +1 more");
  });

  it("extracts paths from partial patch text", () => {
    const header = applyPatchAdapter.formatCallHeader(
      { input: "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old" },
      identityTheme,
    );
    expect(header).toBe("ApplyPatch src/a.ts");
  });
});

describe("applyPatchAdapter.formatCollapsedContent", () => {
  it("renders the repo summary line from preview details", () => {
    const lines = applyPatchAdapter.formatCollapsedContent(
      { input: SINGLE_FILE_PATCH },
      "",
      identityTheme,
      120,
      previewDetails(),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\u2514 patch \+1 -1 (unified|side-by-side) \[-+\]/);
  });

  it("falls back to patch parsing without details", () => {
    const lines = applyPatchAdapter.formatCollapsedContent({ input: SINGLE_FILE_PATCH }, "", identityTheme, 120);
    expect(lines[0]).toContain("└ patch");
    expect(lines[0]).toContain("+1");
    expect(lines[0]).toContain("-1");
  });

  it("shows file counts for multi-file patches", () => {
    const details = previewDetails({
      preview: {
        files: [
          { filePath: "src/app.ts", operation: "update", diff: "", added: 1, removed: 1 },
          { filePath: "src/util.ts", operation: "update", diff: "", added: 0, removed: 1 },
        ],
        added: 1,
        removed: 2,
      },
    });
    const lines = applyPatchAdapter.formatCollapsedContent(
      { input: MULTI_FILE_PATCH },
      "",
      identityTheme,
      120,
      details,
    );
    expect(lines[0]).toContain("· 2 files");
  });

  it("shows in-flight progress when partial", () => {
    const details = previewDetails({ progress: { applied: 1, failed: 0, total: 2 } });
    const lines = applyPatchAdapter.formatCollapsedContent(
      { input: MULTI_FILE_PATCH },
      "",
      identityTheme,
      120,
      details,
      true,
    );
    expect(lines[0]).toContain("1/2");
  });

  it("marks failed hunks after partial failure", () => {
    const details = previewDetails({
      result: {
        summaries: [],
        appliedFiles: ["src/app.ts"],
        failures: [{ filePath: "src/util.ts", operation: "update", message: "boom" }],
        hasPartialSuccess: true,
        recoveryInstructions: { mustReadFiles: [], mustNotReadFiles: [], failedFiles: ["src/util.ts"] },
        details: { fuzz: 0 },
      },
    });
    const lines = applyPatchAdapter.formatCollapsedContent(
      { input: MULTI_FILE_PATCH },
      "",
      identityTheme,
      120,
      details,
    );
    expect(lines[0]).toContain("✗ 1 failed");
  });
});

describe("applyPatchAdapter.formatExpandedContent", () => {
  it("renders the single-file diff", () => {
    const lines = applyPatchAdapter.formatExpandedContent(
      { input: SINGLE_FILE_PATCH },
      "",
      identityTheme,
      120,
      previewDetails(),
    );
    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.join("\n");
    expect(joined).toContain("old");
    expect(joined).toContain("new");
    expect(lines.every((line) => line.startsWith("    ") || line.trim().length > 0)).toBe(true);
  });

  it("renders per-file headers for multi-file patches", () => {
    const details = previewDetails({
      preview: {
        files: [
          { filePath: "src/app.ts", operation: "update", diff: "@@ -1 +1 @@\n-old\n+new\n", added: 1, removed: 1 },
          {
            filePath: "src/old.ts",
            movePath: "src/moved.ts",
            operation: "update",
            diff: "",
            added: 0,
            removed: 0,
          },
        ],
        added: 1,
        removed: 1,
      },
    });
    const lines = applyPatchAdapter.formatExpandedContent({ input: MULTI_FILE_PATCH }, "", identityTheme, 120, details);
    const joined = lines.join("\n");
    expect(joined).toContain("src/app.ts");
    expect(joined).toContain("src/old.ts → src/moved.ts");
    expect(joined).toContain("└");
  });

  it("lists failures in the expanded view", () => {
    const details = previewDetails({
      result: {
        summaries: [],
        appliedFiles: ["src/app.ts"],
        failures: [{ filePath: "src/util.ts", operation: "update", message: "Failed to find expected lines" }],
        hasPartialSuccess: true,
        recoveryInstructions: { mustReadFiles: [], mustNotReadFiles: [], failedFiles: ["src/util.ts"] },
        details: { fuzz: 0 },
      },
    });
    const lines = applyPatchAdapter.formatExpandedContent({ input: MULTI_FILE_PATCH }, "", identityTheme, 120, details);
    expect(lines.join("\n")).toContain("✗ src/util.ts (update): Failed to find expected lines");
  });

  it("falls back to the raw patch text without details", () => {
    const lines = applyPatchAdapter.formatExpandedContent({ input: SINGLE_FILE_PATCH }, "", identityTheme, 120);
    const joined = lines.join("\n");
    expect(joined).toContain("*** Begin Patch");
    expect(joined).toContain("-old");
  });
});
