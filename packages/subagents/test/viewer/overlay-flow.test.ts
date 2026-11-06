import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import toolDisplay from "@htwang-contrib/tool-display";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubagentRunSummary } from "../../src/viewer/index.ts";
import { SubagentViewerOverlay } from "../../src/viewer/overlay.ts";

vi.mock("@htwang-contrib/common/extension-disable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@htwang-contrib/common/extension-disable")>();
  return { ...actual, isExtensionDisabled: () => false };
});

process.env.PI_PACKAGE_DIR = fileURLToPath(
  new URL("../../../../node_modules/@earendil-works/pi-coding-agent", import.meta.url),
);
initTheme("dark", false);

const PLAIN_THEME = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
} as unknown as Theme;

function activateToolDisplay(): void {
  const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => void>>();
  const pi = {
    events: { on: vi.fn(), emit: vi.fn() },
    on: vi.fn((name: string, handler: (event: unknown, ctx: unknown) => void) => {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    }),
  };
  toolDisplay(pi as unknown as ExtensionAPI);
  const sessionStart = handlers.get("session_start")?.[0];
  if (!sessionStart) throw new Error("session_start handler not registered");
  sessionStart(undefined, { mode: "tui", ui: { theme: PLAIN_THEME } });
}

const originalHome = process.env.HOME;
let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "subagents-flow-"));
  process.env.HOME = tmpHome;
  activateToolDisplay();
});
afterEach(() => {
  process.env.HOME = originalHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

type EntryWriter = { file: string; prev: string | null };

function appendEntry(writer: EntryWriter, message: unknown): void {
  const id = crypto.randomBytes(4).toString("hex");
  fs.appendFileSync(
    writer.file,
    `${JSON.stringify({
      type: "message",
      id,
      parentId: writer.prev,
      timestamp: new Date().toISOString(),
      message,
    })}\n`,
  );
  writer.prev = id;
}

/** Child session holding `calls` read tool calls in one assistant message, one
 * assistant text message per `texts` entry, and a user message up front. */
function writeSession(calls: number, texts: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(tmpHome, "child-"));
  const file = path.join(dir, "child.jsonl");
  fs.appendFileSync(
    file,
    `${JSON.stringify({
      type: "session",
      version: 3,
      id: "h1",
      timestamp: new Date().toISOString(),
      cwd: dir,
      parentSession: "test-parent",
    })}\n`,
  );
  const writer: EntryWriter = { file, prev: null };
  appendEntry(writer, { role: "user", content: [{ type: "text", text: "go" }] });
  for (const text of texts) {
    appendEntry(writer, { role: "assistant", content: [{ type: "text", text }] });
  }
  const toolCalls = Array.from({ length: calls }, (_unused, i) => ({
    type: "toolCall",
    id: `call-${i}`,
    name: "read",
    arguments: { path: `file-${i}.ts` },
  }));
  appendEntry(writer, { role: "assistant", content: toolCalls });
  for (let i = 0; i < calls; i++) {
    appendEntry(writer, {
      role: "toolResult",
      toolCallId: `call-${i}`,
      toolName: "read",
      content: [{ type: "text", text: `contents of file-${i}.ts` }],
      isError: false,
      timestamp: new Date().toISOString(),
    });
  }
  return file;
}

function makeRun(file: string): SubagentRunSummary {
  return {
    id: "run",
    subSessionFile: file,
    toolCalls: 1,
    endedAt: "",
    startedAt: "",
    model: "",
    thinking: "",
    cwd: path.dirname(file),
    firstUserText: "go",
    label: "Run",
    running: false,
  };
}

type FakeTui = TUI & { overlayStack: Array<{ component: unknown }> };

/** Mirrors how the host TUI tracks overlays: the entry lives in overlayStack,
 * not in the layout children. */
function makeTui(rows = 40, columns = 100): FakeTui {
  return {
    children: [],
    overlayStack: [],
    requestRender: vi.fn(),
    terminal: { rows, columns },
  } as unknown as FakeTui;
}

function mountOverlay(tui: FakeTui, file: string): SubagentViewerOverlay {
  const overlay = new SubagentViewerOverlay({
    tui,
    theme: PLAIN_THEME,
    parentSessionId: "test-parent",
    runs: [makeRun(file)],
    initialIndex: 0,
    renderOptions: { expanded: false, hideThinkingBlock: false },
    onAction: () => {},
  });
  tui.overlayStack.push({ component: overlay });
  return overlay;
}

describe("SubagentViewerOverlay host-flow parity", () => {
  it("resolves verb-group siblings for the tool rows inside the overlay", () => {
    const file = writeSession(3);
    const tui = makeTui();
    const overlay = mountOverlay(tui, file);
    const view = overlay.render(100).join("\n");
    expect(view).toContain("Read 3 files");
    overlay.dispose();
  });

  it("keeps grouping off when nothing exposes the overlay tree", () => {
    const file = writeSession(3);
    const tui = makeTui();
    const overlay = mountOverlay(tui, file);
    tui.overlayStack = [];
    const view = overlay.render(100).join("\n");
    expect(view).not.toContain("Read 3 files");
    overlay.dispose();
  });

  it("does not double the blank line before an assistant message", () => {
    const file = writeSession(0, ["first answer", "second answer"]);
    const tui = makeTui();
    const overlay = mountOverlay(tui, file);
    const lines = overlay.render(100);
    const first = lines.findIndex((line) => line.includes("first answer"));
    const second = lines.findIndex((line) => line.includes("second answer"));
    const between = lines.slice(first + 1, second).map((line) => stripTerminalSequences(line).slice(2, -2).trim());
    expect(between).toEqual([""]);
    overlay.dispose();
  });

  it("renders the footer hints once", () => {
    const file = writeSession(0, ["answer"]);
    const tui = makeTui();
    const overlay = mountOverlay(tui, file);
    const hints = overlay.render(100).filter((line) => line.includes("picker"));
    expect(hints).toHaveLength(1);
    overlay.dispose();
  });
});

describe("SubagentViewerOverlay mouse routing", () => {
  function wheelEvent(wheelDelta: number): Parameters<SubagentViewerOverlay["handleMouse"]>[0] {
    return {
      type: "wheel",
      button: "none",
      x: 10,
      y: 5,
      screenX: 10,
      screenY: 5,
      width: 100,
      height: 30,
      shift: false,
      alt: false,
      ctrl: false,
      wheelDelta,
    };
  }

  function clickEvent(x: number, y: number): Parameters<SubagentViewerOverlay["handleMouse"]>[0] {
    return {
      type: "click",
      button: "left",
      x,
      y,
      screenX: x,
      screenY: y,
      width: 100,
      height: 30,
      shift: false,
      alt: false,
      ctrl: false,
    };
  }

  it("scrolls its own body on wheel events", () => {
    const texts = Array.from({ length: 40 }, (_unused, i) => `line ${i} of the transcript`);
    const file = writeSession(0, texts);
    const tui = makeTui(20, 100);
    const overlay = mountOverlay(tui, file);
    expect(overlay.render(100).join("\n")).toContain("line 39 of the transcript");
    expect(overlay.handleMouse(wheelEvent(-3))).toEqual({ handled: true });
    expect(overlay.render(100).join("\n")).not.toContain("line 39 of the transcript");
    overlay.dispose();
  });

  it("ignores wheel events when there is no run to scroll", () => {
    const overlay = new SubagentViewerOverlay({
      tui: makeTui(),
      theme: PLAIN_THEME,
      parentSessionId: "test-parent",
      runs: [],
      initialIndex: 0,
      renderOptions: { expanded: false, hideThinkingBlock: false },
      onAction: () => {},
    });
    overlay.render(100);
    expect(overlay.handleMouse(wheelEvent(-1))).toBeUndefined();
    overlay.dispose();
  });

  it("forwards body clicks to the tool row under the cursor", () => {
    const file = writeSession(1);
    const tui = makeTui(30, 100);
    const overlay = mountOverlay(tui, file);
    const before = overlay.render(100);
    const row = before.findIndex((line) => line.includes("file-0.ts"));
    expect(row).toBeGreaterThan(0);
    const result = overlay.handleMouse(clickEvent(6, row));
    expect(result?.handled).toBe(true);
    const after = overlay.render(100);
    expect(after.join("\n")).not.toBe(before.join("\n"));
    overlay.dispose();
  });

  it("leaves frame and header rows alone", () => {
    const file = writeSession(1);
    const tui = makeTui(30, 100);
    const overlay = mountOverlay(tui, file);
    overlay.render(100);
    expect(overlay.handleMouse(clickEvent(4, 0))).toBeUndefined();
    expect(overlay.handleMouse(clickEvent(4, 1))).toBeUndefined();
    overlay.dispose();
  });
});
