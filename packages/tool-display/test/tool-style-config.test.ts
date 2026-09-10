import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { editAdapter as editAdapterType } from "../src/adapters/edit.ts";
import type { readAdapter as readAdapterType } from "../src/adapters/read.ts";
import type { renderToolCall as renderToolCallType } from "../src/tool-call-display.ts";

const PLAIN_THEME: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

let tmpDir: string;
let editAdapter: typeof editAdapterType;
let readAdapter: typeof readAdapterType;
let renderToolCall: typeof renderToolCallType;
let globalToolDisplayRegistry: typeof import("../src/registry.ts").globalToolDisplayRegistry;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "tool-display-style-"));
  vi.stubEnv("XDG_CONFIG_HOME", tmpDir);
  vi.resetModules();
  const [editMod, readMod, renderMod, registryMod] = await Promise.all([
    import("../src/adapters/edit.ts"),
    import("../src/adapters/read.ts"),
    import("../src/tool-call-display.ts"),
    import("../src/registry.ts"),
  ]);
  editAdapter = editMod.editAdapter;
  readAdapter = readMod.readAdapter;
  renderToolCall = renderMod.renderToolCall;
  globalToolDisplayRegistry = registryMod.globalToolDisplayRegistry;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
});

function writeConfig(section: Record<string, unknown>): void {
  const dir = join(tmpDir, "pi");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "extensions.json"), JSON.stringify({ "tool-display": section }));
}

function renderCollapsed(
  toolName: string,
  args: Record<string, unknown>,
  output: string,
  isError = false,
  width = 80,
): string[] {
  return renderToolCall(
    {
      toolName,
      args,
      output,
      expanded: false,
      isPartial: false,
      isError,
      registry: globalToolDisplayRegistry,
    },
    PLAIN_THEME,
  ).render(width);
}

describe("editStyle config", () => {
  it("renders the collapsed edit as a single line with diff stats in the header by default", () => {
    globalToolDisplayRegistry.register("edit", editAdapter);
    const lines = renderCollapsed(
      "edit",
      { path: "src/foo.ts", edits: [{ oldText: "a\nb\nc", newText: "a\nX\nc" }] },
      "Edited src/foo.ts",
    );
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("Edit");
    expect(lines[0]).toContain("src/foo.ts");
    expect(lines[0]).toContain("+1");
    expect(lines[0]).toContain("-1");
    expect(lines.join("\n")).not.toContain("└");
  });

  it("renders the collapsed edit as a two-line block when editStyle is two-line", () => {
    writeConfig({ editStyle: "two-line" });
    globalToolDisplayRegistry.register("edit", editAdapter);
    const lines = renderCollapsed(
      "edit",
      { path: "src/foo.ts", edits: [{ oldText: "a\nb\nc", newText: "a\nX\nc" }] },
      "Edited src/foo.ts",
    );
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("Edit");
    expect(lines[0]).toContain("src/foo.ts");
    expect(lines[0]).not.toContain("+1");
    expect(lines[0]).not.toContain("-1");
    expect(lines[1]).toContain("└");
    expect(lines[1]).toContain("diff");
    expect(lines[1]).toContain("+1");
    expect(lines[1]).toContain("-1");
  });

  it("shows the legacy no-changes row when editStyle is two-line and edits are empty", () => {
    writeConfig({ editStyle: "two-line" });
    globalToolDisplayRegistry.register("edit", editAdapter);
    const lines = renderCollapsed("edit", { path: "src/foo.ts" }, "Edited src/foo.ts");
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("└");
    expect(lines[1]).toContain("no changes");
  });

  it("still shows no collapsed content when editStyle is single-line and edits are empty", () => {
    globalToolDisplayRegistry.register("edit", editAdapter);
    const lines = renderCollapsed("edit", { path: "src/foo.ts" }, "Edited src/foo.ts");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("Edit");
    expect(lines[0]).not.toContain("└");
  });
});

describe("readStyle config", () => {
  it("renders the collapsed read as a two-line block with the legacy └ row by default", () => {
    globalToolDisplayRegistry.register("read", readAdapter);
    const lines = renderCollapsed("read", { path: "src/foo.ts" }, "a\nb\nc\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("Read");
    expect(lines[0]).toContain("src/foo.ts");
    expect(lines[1]).toContain("└");
    expect(lines[1]).toContain("3 lines");
  });

  it("renders the collapsed read as a single line with an inline line-count when readStyle is single-line", () => {
    writeConfig({ readStyle: "single-line" });
    globalToolDisplayRegistry.register("read", readAdapter);
    const lines = renderCollapsed("read", { path: "src/foo.ts" }, "a\nb\nc\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("Read");
    expect(lines[0]).toContain("src/foo.ts");
    expect(lines[0]).toContain("· 3 lines");
    expect(lines.join("\n")).not.toContain("└");
  });

  it("drops the inline line-count suffix when the header has no room for it", () => {
    writeConfig({ readStyle: "single-line" });
    globalToolDisplayRegistry.register("read", readAdapter);
    const lines = renderCollapsed(
      "read",
      { path: "src/some/very/long/path/that/will/not/fit/in/a/narrow/terminal/foo.ts" },
      "a\nb\nc\n",
      false,
      20,
    );
    expect(lines.join("\n")).toContain("Read");
    expect(lines.join("\n")).not.toContain("· 3 lines");
  });

  it("keeps the legacy row when readStyle is two-line even with offset/limit args", () => {
    globalToolDisplayRegistry.register("read", readAdapter);
    const lines = renderCollapsed("read", { path: "src/foo.ts", offset: 5, limit: 3 }, "a\nb\nc\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain(":5-7");
    expect(lines[1]).toContain("└");
  });
});
