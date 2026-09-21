import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type { ApplyPatchToolDetails } from "@htwang-contrib/apply-patch/preview";
import { clearConfigItems, getConfigItems, setConfigKey } from "@htwang-contrib/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyPatchAdapter } from "../src/adapters/apply-patch.ts";
import { registerToolDisplayConfigItems, saveConfig } from "../src/config.ts";
import { renderToolCall, type ToolCallDisplayOpts, ToolDisplayRegistry } from "../src/tool-call-display.ts";

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

let configDir: string;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "apply-patch-display-"));
  vi.stubEnv("XDG_CONFIG_HOME", configDir);
});

afterEach(() => {
  clearConfigItems("tool-display");
  vi.unstubAllEnvs();
  rmSync(configDir, { recursive: true, force: true });
});

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

function patchDisplay(overrides: Partial<ToolCallDisplayOpts> = {}) {
  const registry = new ToolDisplayRegistry();
  registry.register("apply_patch", applyPatchAdapter);
  return renderToolCall(
    {
      toolName: "apply_patch",
      args: { input: SINGLE_FILE_PATCH },
      output: "Updated src/app.ts",
      expanded: false,
      isPartial: false,
      isError: false,
      registry,
      ...overrides,
    },
    identityTheme,
  );
}

describe("applyPatchAdapter.formatCallHeader", () => {
  it("shows the tool title with placeholder while streaming", () => {
    const header = applyPatchAdapter.formatCallHeader({ input: "*** Begin Patch\n" }, identityTheme);
    expect(header).toBe("ApplyPatch ...");
  });

  it("shows the first patched path with inline stats by default", () => {
    const header = applyPatchAdapter.formatCallHeader({ input: SINGLE_FILE_PATCH }, identityTheme);
    expect(header).toBe("ApplyPatch src/app.ts +1 -1 [------]");
  });

  it("shows remaining file count for multi-file patches", () => {
    const header = applyPatchAdapter.formatCallHeader({ input: MULTI_FILE_PATCH }, identityTheme);
    expect(header).toContain("ApplyPatch src/app.ts +1 more");
    expect(header).toContain("· 2 files");
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
  beforeEach(() => {
    saveConfig({ applyPatchStyle: "two-line" });
  });

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

describe("apply_patch display style", () => {
  it("renders one row with inline stats by default", () => {
    const lines = patchDisplay().render(120);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("ApplyPatch src/app.ts +1 -1 side-by-side [------]");
    expect(lines[0]).not.toContain("└");
  });

  it("switches between one and two rows when the persisted setting changes", () => {
    registerToolDisplayConfigItems();
    const item = getConfigItems("tool-display").find((item) => item.key === "applyPatchStyle");
    if (item?.type !== "select" || typeof item.value !== "function") {
      throw new Error("Expected an ApplyPatch style select config item");
    }
    expect(item.value()).toBe("single-line");
    expect(item.options).toEqual([
      { label: "Single-line", value: "single-line" },
      { label: "Two-line", value: "two-line" },
    ]);

    const display = patchDisplay();
    setConfigKey("tool-display", item.key, "two-line");
    expect(item.value()).toBe("two-line");
    const lines = display.render(120);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("ApplyPatch src/app.ts");
    expect(lines[0]).not.toContain("+1");
    expect(lines[1]).toContain("└ patch +1 -1 side-by-side [------]");

    setConfigKey("tool-display", item.key, "single-line");
    expect(display.render(120)).toHaveLength(1);
  });

  it("uses preview counts and progress while applying the patch", () => {
    const details = previewDetails({
      preview: {
        files: [{ filePath: "src/app.ts", operation: "delete", diff: "", added: 0, removed: 12 }],
        added: 0,
        removed: 12,
      },
      progress: { applied: 0, failed: 0, total: 1 },
    });
    const lines = patchDisplay({ details, isPartial: true, output: "Applying patch (0/1)..." }).render(120);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("0/1 -12 side-by-side");
    expect(lines[0]).not.toContain("+1");
  });

  it("keeps the failure count visible after partial success", () => {
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
    const lines = patchDisplay({
      args: { input: MULTI_FILE_PATCH },
      details,
      output: "apply_patch partially failed.",
    }).render(120);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("✗ 1 failed");
  });

  it("preserves error reasons in single-line mode", () => {
    const lines = patchDisplay({ isError: true, output: "Failed to find expected lines" }).render(120);
    expect(lines.join("\n")).toContain("└ Failed to find expected lines");
  });

  it("drops the entire suffix when it cannot fit after the header", () => {
    const display = patchDisplay({ args: { input: SINGLE_FILE_PATCH.replace("src/app.ts", "src/界.ts") } });
    const fullLine = display.render(80)[0];
    const exactWidth = visibleWidth(fullLine);
    expect(display.render(exactWidth)).toEqual([fullLine]);
    const lines = display.render(exactWidth - 1);
    expect(lines).toHaveLength(1);
    expect(stripTerminalSequences(lines[0])).toBe("  ┃  ◆ ApplyPatch src/界.ts");

    for (const width of [0, 5, 7, 20, 40]) {
      const narrowLines = display.render(width);
      expect(narrowLines).toHaveLength(1);
      expect(narrowLines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });
});

describe.each(["single-line", "two-line"] as const)("applyPatchAdapter.formatExpandedContent (%s)", (style) => {
  beforeEach(() => {
    saveConfig({ applyPatchStyle: style });
  });

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
