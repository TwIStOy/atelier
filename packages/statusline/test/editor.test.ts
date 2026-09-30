import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { setVirtualModelStatus } from "@htwang-contrib/common";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MyEditor } from "../src/editor.ts";

vi.mock("../src/config.ts", () => ({
  loadConfig: () => ({ borderColor: "dim" }),
}));

const CURSOR_MARKER = "\x1b_pi:c\x07";

function stripStyling(s: string): string {
  return s.replaceAll(CURSOR_MARKER, "").replace(/\x1b\[[0-9;]*m/g, "");
}

function makeEditor(overrides: Partial<ExtensionContext> = {}): InstanceType<typeof MyEditor> {
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
    ...overrides,
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

const physicalModel: Model<Api> = {
  provider: "test-router",
  id: "middle",
  name: "Middle",
  api: "test-chat",
  baseUrl: "https://unused.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 400_000,
  maxTokens: 8192,
};

afterEach(() => setVirtualModelStatus("editor-route", undefined));

describe("MyEditor virtual route", () => {
  test("shows the tier, physical model and current limit with a recomputed percentage", () => {
    setVirtualModelStatus("editor-route", {
      provider: "virtual",
      modelId: "auto",
      tier: "middle",
      physicalModel,
      thinkingLevel: "off",
    });
    const editor = makeEditor({
      model: {
        ...physicalModel,
        provider: "virtual",
        id: "auto",
        api: "pi-virtual",
        name: "Auto",
        contextWindow: 200_000,
      },
      sessionManager: {
        getEntries: () => [],
        getSessionId: () => "editor-route",
      } as unknown as ExtensionContext["sessionManager"],
      getContextUsage: () => ({ tokens: 100_000, contextWindow: 200_000, percent: 50 }),
    });
    let top = stripStyling(editor.render(120)[0]);
    expect(top).toContain("25% of 400K");
    expect(top).toContain("Auto · middle → test-router/middle");
    setVirtualModelStatus("editor-route", {
      provider: "virtual",
      modelId: "auto",
      tier: "flagship",
      physicalModel: { ...physicalModel, id: "flagship", contextWindow: 100_000 },
      thinkingLevel: "off",
    });
    top = stripStyling(editor.render(120)[0]);
    expect(top).toContain("100% of 100K");
    expect(top).toContain("Auto · flagship → test-router/flagship");
    for (const width of [25, 46, 80]) {
      for (const line of editor.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  test("preserves unknown usage after compaction while showing the routed limit", () => {
    setVirtualModelStatus("editor-route", {
      provider: "virtual",
      modelId: "auto",
      tier: "middle",
      physicalModel,
      thinkingLevel: "off",
    });
    const editor = makeEditor({
      model: { ...physicalModel, provider: "virtual", id: "auto", api: "pi-virtual" },
      sessionManager: {
        getEntries: () => [],
        getSessionId: () => "editor-route",
      } as unknown as ExtensionContext["sessionManager"],
      getContextUsage: () => ({ tokens: null, contextWindow: 200_000, percent: null }),
    });
    expect(stripStyling(editor.render(120)[0])).toContain("? of 400K");
  });
});

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
