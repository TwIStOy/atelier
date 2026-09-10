import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";

vi.mock("../src/config.ts", () => ({
  loadConfig: () => ({ borderColor: "dim" }),
}));

const { MyEditor } = await import("../src/editor.ts");

const CURSOR_MARKER = "\x1b_pi:c\x07";

function stripStyling(s: string): string {
  return s.replaceAll(CURSOR_MARKER, "").replace(/\x1b\[[0-9;]*m/g, "");
}

function makeEditor(): InstanceType<typeof MyEditor> {
  const tui = { terminal: { rows: 40 }, requestRender: () => {} } as unknown as TUI;
  const theme: EditorTheme = {
    borderColor: (s: string) => s,
    selectList: {} as never,
  };
  const ctx = {
    ui: { theme: { fg: (_color: string, text: string) => text } },
    getContextUsage: () => ({ percent: 10, contextWindow: 1_000_000 }),
    sessionManager: { getEntries: () => [] },
    model: { name: "GLM", contextWindow: 1_000_000 },
    cwd: "/home/hawtian/pi-extensions",
  } as unknown as ExtensionContext;
  const pi = { getThinkingLevel: () => "off" } as unknown as ExtensionAPI;
  const EditorCtor = MyEditor as unknown as new (
    tui: TUI,
    theme: EditorTheme,
    keybindings: unknown,
    getCtx: () => ExtensionContext,
    pi: ExtensionAPI,
  ) => InstanceType<typeof MyEditor>;
  return new EditorCtor(tui, theme, {}, () => ctx, pi);
}

describe("MyEditor prompt prefix", () => {
  test("first body line is prefixed with ❯, continuations get a 2-space hang indent", () => {
    const editor = makeEditor();
    editor.setText(`Test ${"a".repeat(60)}`);

    const lines = editor.render(46).map(stripStyling);
    expect(lines[1].startsWith("│ ❯ Test")).toBe(true);
    expect(lines[2].startsWith("│   ")).toBe(true);
    expect(lines[2].slice(2, 4)).toBe("  ");
    expect(lines.at(-1)?.startsWith("╰")).toBe(true);
  });

  test("body lines keep box width with the prefix reserved", () => {
    const editor = makeEditor();
    editor.setText(`Test ${"b".repeat(60)}`);

    const lines = editor.render(46);
    for (const line of lines.slice(1, -1)) {
      expect(visibleWidth(line)).toBe(46);
    }
  });

  test("CURSOR_MARKER stays intact for hardware-cursor extraction", () => {
    const editor = makeEditor();
    editor.focused = true;
    editor.setText("hello");

    const lines = editor.render(46);
    const body = lines.find((line) => line.includes(CURSOR_MARKER));
    expect(body).toBeDefined();
    expect(body?.startsWith("│ ❯")).toBe(true);
  });

  test("empty editor still shows the prompt on the first body line", () => {
    const editor = makeEditor();
    const lines = editor.render(46).map(stripStyling);
    expect(lines[1].startsWith("│ ❯")).toBe(true);
  });
});
