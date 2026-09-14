import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { editAdapter as editAdapterType } from "../src/adapters/edit.ts";
import type {
  memoryReadAdapter as memoryReadAdapterType,
  memorySearchAdapter as memorySearchAdapterType,
  memoryUpdateAdapter as memoryUpdateAdapterType,
} from "../src/adapters/memory.ts";
import type { readAdapter as readAdapterType } from "../src/adapters/read.ts";
import type { writeAdapter as writeAdapterType } from "../src/adapters/write.ts";
import type { renderToolCall as renderToolCallType } from "../src/tool-call-display.ts";

const PLAIN_THEME: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

let tmpDir: string;
let editAdapter: typeof editAdapterType;
let readAdapter: typeof readAdapterType;
let writeAdapter: typeof writeAdapterType;
let memoryReadAdapter: typeof memoryReadAdapterType;
let memoryUpdateAdapter: typeof memoryUpdateAdapterType;
let memorySearchAdapter: typeof memorySearchAdapterType;
let renderToolCall: typeof renderToolCallType;
let globalToolDisplayRegistry: typeof import("../src/registry.ts").globalToolDisplayRegistry;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "tool-display-style-"));
  vi.stubEnv("XDG_CONFIG_HOME", tmpDir);
  vi.resetModules();
  const [editMod, readMod, writeMod, memoryMod, renderMod, registryMod] = await Promise.all([
    import("../src/adapters/edit.ts"),
    import("../src/adapters/read.ts"),
    import("../src/adapters/write.ts"),
    import("../src/adapters/memory.ts"),
    import("../src/tool-call-display.ts"),
    import("../src/registry.ts"),
  ]);
  editAdapter = editMod.editAdapter;
  readAdapter = readMod.readAdapter;
  writeAdapter = writeMod.writeAdapter;
  memoryReadAdapter = memoryMod.memoryReadAdapter;
  memoryUpdateAdapter = memoryMod.memoryUpdateAdapter;
  memorySearchAdapter = memoryMod.memorySearchAdapter;
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
  details?: unknown,
): string[] {
  return renderToolCall(
    {
      toolName,
      args,
      output,
      details,
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
    expect(lines[0]).toContain("Edited");
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
    expect(lines[0]).toContain("Edited");
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
    expect(lines[0]).toContain("Edited");
    expect(lines[0]).not.toContain("└");
  });
});

describe("memoryStyle config", () => {
  it("renders the collapsed memory-read as a single line with an inline summary by default", () => {
    globalToolDisplayRegistry.register("memory-read", memoryReadAdapter);
    const lines = renderCollapsed("memory-read", { uri: "core://agent" }, "{}", false, 80, {
      uri: "core://agent",
      content_preview: "hello world\nsecond",
      content_lines: 2,
    });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("Memory read");
    expect(lines[0]).toContain("core://agent");
    expect(lines[0]).toContain("2 lines");
    expect(lines.join("\n")).not.toContain("└");
  });

  it("renders the collapsed memory-read as a two-line block when memoryStyle is two-line", () => {
    writeConfig({ memoryStyle: "two-line" });
    globalToolDisplayRegistry.register("memory-read", memoryReadAdapter);
    const lines = renderCollapsed("memory-read", { uri: "core://agent" }, "{}", false, 80, {
      uri: "core://agent",
      content_preview: "hello world\nsecond",
      content_lines: 2,
    });
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("Memory read");
    expect(lines[0]).not.toContain("2 lines");
    expect(lines[1]).toContain("└");
    expect(lines[1]).toContain("2 lines");
  });

  it("renders the collapsed memory-update diff stats inline by default", () => {
    globalToolDisplayRegistry.register("memory-update", memoryUpdateAdapter);
    const lines = renderCollapsed("memory-update", { uri: "core://agent" }, "{}", false, 80, {
      uri: "core://agent",
      mode: "patch",
      diff_adds: 3,
      diff_removes: 1,
      priority: 4,
    });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("+3");
    expect(lines[0]).toContain("-1");
    expect(lines[0]).toContain("p4");
    expect(lines.join("\n")).not.toContain("└");
  });

  it("renders the collapsed memory-search summary inline by default", () => {
    globalToolDisplayRegistry.register("memory-search", memorySearchAdapter);
    const lines = renderCollapsed("memory-search", { query: "foo" }, "{}", false, 120, {
      query: "foo",
      total: 2,
      items: [{ uri: "core://agent/identity", snippet: "snippet text" }],
    });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("Memory search");
    expect(lines[0]).toContain("2 results");
    expect(lines.join("\n")).not.toContain("└");
  });

  it("shows an inline empty marker for memory-read with no content", () => {
    globalToolDisplayRegistry.register("memory-read", memoryReadAdapter);
    const lines = renderCollapsed("memory-read", { uri: "core://agent" }, "{}", false, 80, {
      uri: "core://agent",
      content_preview: "",
      content_lines: 0,
    });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("empty");
    expect(lines.join("\n")).not.toContain("└");
  });
});

describe("writeStyle config", () => {
  it("renders the collapsed write as a single line with the line count in the header by default", () => {
    globalToolDisplayRegistry.register("write", writeAdapter);
    const lines = renderCollapsed("write", { path: "src/foo.ts", content: "a\nb\nc" }, "Wrote src/foo.ts");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("Wrote");
    expect(lines[0]).toContain("src/foo.ts");
    expect(lines[0]).toContain("+3");
    expect(lines.join("\n")).not.toContain("└");
  });

  it("renders the collapsed write as a two-line block when writeStyle is two-line", () => {
    writeConfig({ writeStyle: "two-line" });
    globalToolDisplayRegistry.register("write", writeAdapter);
    const lines = renderCollapsed("write", { path: "src/foo.ts", content: "a\nb\nc" }, "Wrote src/foo.ts");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("Wrote");
    expect(lines[0]).not.toContain("+3");
    expect(lines[1]).toContain("└");
    expect(lines[1]).toContain("3 lines");
  });

  it("keeps the legacy empty-file row when writeStyle is two-line", () => {
    writeConfig({ writeStyle: "two-line" });
    globalToolDisplayRegistry.register("write", writeAdapter);
    const lines = renderCollapsed("write", { path: "src/foo.ts", content: "" }, "Wrote src/foo.ts");
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("└");
    expect(lines[1]).toContain("empty file");
  });

  it("drops the inline line-count suffix when the header has no room for it", () => {
    globalToolDisplayRegistry.register("write", writeAdapter);
    const lines = renderCollapsed(
      "write",
      { path: "src/some/very/long/path/that/will/not/fit/in/a/narrow/terminal/foo.ts", content: "a\nb\nc" },
      "Wrote src/foo.ts",
      false,
      20,
    );
    expect(lines.join("\n")).toContain("Wrote");
    expect(lines.join("\n")).not.toContain("+3");
    expect(lines.join("\n")).not.toContain("└");
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
