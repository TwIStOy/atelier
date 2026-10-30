import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { type EditorTheme, setKeybindings, type TUI } from "@earendil-works/pi-tui";
import * as common from "@htwang-contrib/common";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BetterEditorConfig } from "../src/config.ts";
import { BetterEditor } from "../src/editor.ts";
import { loadHistoryTextsNewestFirst, persistHistoryMergedWithDisk } from "../src/history-store.ts";
import betterEditor from "../src/index.ts";
import { createKeybindings } from "./helpers.ts";

const settings = vi.hoisted(() => ({ disabled: false, config: {} as Partial<BetterEditorConfig> }));

vi.mock("@htwang-contrib/common", async (importOriginal) => ({
  ...(await importOriginal<typeof common>()),
  isExtensionDisabled: vi.fn(() => settings.disabled),
  registerConfigItems: vi.fn(),
  readConfig: vi.fn((_name: string, schema: { defaults: BetterEditorConfig }) => ({
    ...schema.defaults,
    ...settings.config,
  })),
}));

vi.mock("../src/history-store.ts", () => ({
  MAX_ENTRIES: 1000,
  loadHistoryTextsNewestFirst: vi.fn(() => []),
  persistHistoryMergedWithDisk: vi.fn(),
}));

type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown;
type EditorFactory = NonNullable<Parameters<ExtensionUIContext["setEditorComponent"]>[0]>;

function createHarness(mode: ExtensionContext["mode"] = "tui") {
  const handlers = new Map<string, EventHandler[]>();
  const listeners = new Map<string, (data: unknown) => void>();
  const keybindings = createKeybindings({ "app.session.rename": ["ctrl+r", "ctrl+n"] });
  setKeybindings(keybindings);
  const tui = { terminal: { columns: 100, rows: 40 }, requestRender: vi.fn() } as unknown as TUI;
  const theme: EditorTheme = { borderColor: (text) => text, selectList: {} as never };
  let editor: BetterEditor | undefined;
  const ui = {
    theme: { fg: (_color: string, text: string) => text },
    setEditorComponent: vi.fn((factory: EditorFactory) => {
      editor = factory(tui, theme, keybindings) as BetterEditor;
    }),
    setFooter: vi.fn(),
    setEditorText: vi.fn((text: string) => editor?.setText(text)),
    notify: vi.fn(),
    custom: vi.fn().mockResolvedValue("selected\noriginal prompt"),
  };
  const ctx = {
    mode,
    hasUI: mode === "tui" || mode === "rpc",
    ui,
    cwd: "/tmp/better-editor-test",
    model: { name: "Test Model", contextWindow: 100_000 },
    getContextUsage: () => ({ percent: 10, contextWindow: 100_000 }),
    sessionManager: { getEntries: () => [] },
  } as unknown as ExtensionContext;
  const registerShortcut = vi.fn<ExtensionAPI["registerShortcut"]>();
  const pi = {
    on: (event: string, handler: EventHandler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    events: {
      on: (name: string, handler: (data: unknown) => void) => {
        listeners.set(name, handler);
        return () => listeners.delete(name);
      },
    },
    getThinkingLevel: () => "off",
    registerShortcut,
  } as unknown as ExtensionAPI;
  betterEditor(pi);

  return {
    ctx,
    keybindings,
    listeners,
    registerShortcut,
    ui,
    emit(name: string, event: unknown = {}) {
      for (const handler of handlers.get(name) ?? []) handler(event, ctx);
    },
    editor() {
      if (!editor) throw new Error("Editor was not installed");
      return editor;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  settings.disabled = false;
  settings.config = {};
  vi.mocked(loadHistoryTextsNewestFirst).mockReturnValue([]);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  setKeybindings(createKeybindings());
});

describe("better-editor integration", () => {
  test("installs rendering and flattened history in one editor without a footer", () => {
    vi.mocked(loadHistoryTextsNewestFirst).mockReturnValue(["new\n  prompt", "new prompt", "older"]);
    const app = createHarness();
    app.emit("session_start");
    const editor = app.editor();
    expect(editor).toBeInstanceOf(BetterEditor);
    expect(app.ui.setEditorComponent).toHaveBeenCalledTimes(1);
    expect(app.ui.setFooter).not.toHaveBeenCalled();
    expect(editor.render(100)[1]).toContain("│ ❯");
    editor.handleInput("\x1b[A");
    expect(editor.getText()).toBe("new prompt");
    editor.handleInput("\x1b[A");
    expect(editor.getText()).toBe("older");
    editor.setText("");
    editor.addToHistory(" next\n  prompt ");
    expect(persistHistoryMergedWithDisk).toHaveBeenLastCalledWith(["next\n  prompt"]);
    editor.handleInput("\x1b[A");
    expect(editor.getText()).toBe("next prompt");
  });

  test("retains arrow navigation beyond Pi's native 100-entry limit", () => {
    vi.mocked(loadHistoryTextsNewestFirst).mockReturnValue(
      Array.from({ length: 1005 }, (_, index) => `prompt ${index}`),
    );
    const app = createHarness();
    app.emit("session_start");
    for (let i = 0; i < 1005; i++) app.editor().handleInput("\x1b[A");
    expect(app.editor().getText()).toBe("prompt 999");
  });

  test("requires two interrupt presses while streaming and clears the border hint", () => {
    const app = createHarness();
    app.emit("session_start");
    const editor = app.editor();
    const abort = vi.fn();
    editor.onEscape = abort;
    app.emit("agent_start");
    editor.handleInput("\x1b");
    expect(abort).not.toHaveBeenCalled();
    expect(editor.render(100)[0]).toContain("esc again to abort");
    editor.handleInput("\x1b");
    expect(abort).toHaveBeenCalledTimes(1);
    expect(editor.render(100)[0]).not.toContain("esc again to abort");
    expect(vi.getTimerCount()).toBe(0);
  });

  test("expires the confirmation window and resets on agent end", () => {
    const app = createHarness();
    app.emit("session_start");
    const editor = app.editor();
    const abort = vi.fn();
    editor.onEscape = abort;
    app.emit("agent_start");
    editor.handleInput("\x1b");
    vi.advanceTimersByTime(600);
    expect(editor.render(100)[0]).not.toContain("esc again to abort");
    editor.handleInput("\x1b");
    expect(abort).not.toHaveBeenCalled();
    app.emit("agent_end");
    expect(editor.render(100)[0]).not.toContain("esc again to abort");
    expect(vi.getTimerCount()).toBe(0);
    editor.handleInput("\x1b");
    expect(abort).toHaveBeenCalledTimes(1);
  });

  test("follows the configured interrupt binding", () => {
    const app = createHarness();
    app.keybindings.setUserBindings({ "app.interrupt": "ctrl+k" });
    app.emit("session_start");
    app.emit("agent_start");
    const abort = vi.fn();
    app.editor().onEscape = abort;
    app.editor().handleInput("\x0b");
    expect(abort).not.toHaveBeenCalled();
    app.editor().handleInput("\x0b");
    expect(abort).toHaveBeenCalledTimes(1);
  });

  test("passes autocomplete dismissal and disabled confirmation through immediately", () => {
    const app = createHarness();
    app.emit("session_start");
    app.emit("agent_start");
    const editor = app.editor();
    const autocomplete = vi.spyOn(editor, "isShowingAutocomplete").mockReturnValue(true);
    editor.handleInput("\x1b");
    expect(editor.render(100)[0]).not.toContain("esc again to abort");
    expect(vi.getTimerCount()).toBe(0);
    autocomplete.mockRestore();
    settings.config.doubleEscapeEnabled = false;
    const abort = vi.fn();
    editor.onEscape = abort;
    editor.handleInput("\x1b");
    expect(abort).toHaveBeenCalledTimes(1);
  });

  test("cleans up hints and interrupt timers when a session is replaced", () => {
    const app = createHarness();
    app.emit("session_start");
    const first = app.editor();
    app.emit("agent_start");
    first.handleInput("\x1b");
    app.listeners.get(common.EDITOR_HINT_EVENT)?.({ source: "test", text: "external hint" });
    expect(first.render(100)[0]).toContain("external hint");
    app.emit("session_shutdown");
    expect(app.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    app.emit("session_start");
    expect(app.editor()).not.toBe(first);
    expect(app.listeners.size).toBe(1);
    expect(app.editor().render(100)[0]).not.toContain("external hint");
    expect(app.editor().render(100)[0]).not.toContain("esc again to abort");
    const abort = vi.fn();
    app.editor().onEscape = abort;
    app.editor().handleInput("\x1b");
    expect(abort).toHaveBeenCalledTimes(1);
  });

  test("opens history search and preserves other session-rename bindings", async () => {
    vi.mocked(loadHistoryTextsNewestFirst).mockReturnValue(["saved prompt"]);
    const app = createHarness();
    app.emit("session_start");
    expect(app.keybindings.getUserBindings()["app.session.rename"]).toEqual("ctrl+n");
    const [key, shortcut] = app.registerShortcut.mock.calls[0];
    expect(key).toBe("ctrl+r");
    await shortcut.handler(app.ctx);
    expect(app.ui.custom).toHaveBeenCalledTimes(1);
    expect(app.editor().getText()).toBe("selected\noriginal prompt");
  });

  test("records noninteractive input without installing terminal UI", () => {
    const app = createHarness("rpc");
    app.emit("session_start");
    app.emit("input", { text: " command-line\nprompt " });
    app.emit("input", { text: "   " });
    expect(app.ui.setEditorComponent).not.toHaveBeenCalled();
    expect(app.listeners.size).toBe(0);
    expect(persistHistoryMergedWithDisk).toHaveBeenCalledExactlyOnceWith(["command-line\nprompt"]);
  });

  test("registers editor settings only under better-editor", () => {
    createHarness();
    expect(common.registerConfigItems).toHaveBeenCalledExactlyOnceWith(
      "better-editor",
      expect.arrayContaining([
        expect.objectContaining({ key: "borderColor" }),
        expect.objectContaining({ key: "doubleEscapeEnabled" }),
        expect.objectContaining({ key: "doubleEscapeDebounceMs" }),
      ]),
    );
  });

  test("registers nothing when disabled", () => {
    settings.disabled = true;
    const app = createHarness();
    app.emit("session_start");
    app.emit("input", { text: "ignored" });
    expect(common.isExtensionDisabled).toHaveBeenCalledWith("better-editor");
    expect(common.registerConfigItems).not.toHaveBeenCalled();
    expect(app.ui.setEditorComponent).not.toHaveBeenCalled();
    expect(app.registerShortcut).not.toHaveBeenCalled();
    expect(persistHistoryMergedWithDisk).not.toHaveBeenCalled();
  });
});
