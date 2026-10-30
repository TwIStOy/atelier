import { fileURLToPath } from "node:url";
import { initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import {
  Container,
  ScrollView,
  stripTerminalSequences,
  type Terminal,
  Text,
  TuiAltScreen,
  TuiMainScreen,
  VStack,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { afterEach, describe, expect, test, vi } from "vitest";
import { installStickyPrompt } from "../src/sticky-prompt.ts";

process.env.PI_PACKAGE_DIR = fileURLToPath(
  new URL("../../../node_modules/@earendil-works/pi-coding-agent", import.meta.url),
);
initTheme("dark", false);

const cleanups: (() => void)[] = [];

function setup(prompts = ["First prompt", "Second prompt"], columns = 60, rows = 18) {
  let input: (data: string) => void = () => {};
  const terminal = {
    columns,
    rows,
    kittyProtocolActive: false,
    start: (onInput: (data: string) => void) => {
      input = onInput;
    },
    stop() {},
    drainInput: async () => {},
    write: vi.fn(),
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
    setProgramStatus() {},
  } satisfies Terminal;
  const tui = new TuiAltScreen(terminal);
  const document = new Container();
  const chat = new Container();
  const header = new Text("Session header", 0, 0);
  document.addChild(header);
  document.addChild(chat);
  const users = prompts.map((prompt) => new UserMessageComponent(prompt));
  const responses = users.map((_, index) => {
    const response = new Text(
      Array.from({ length: 40 }, (_value, row) => `Reply ${index + 1}, row ${row + 1}`).join("\n"),
      0,
      0,
    );
    chat.addChild(users[index]);
    chat.addChild(response);
    return response;
  });
  const view = new ScrollView(document, { follow: "end", primary: true, scrollbar: "always" });
  const editor = Object.assign(new Text("Editor\nFooter\nStatus", 0, 0), { handleInput: vi.fn() });
  tui.setLayoutRoot(
    new VStack([
      { component: view, basis: 0, grow: 1, minSize: 1 },
      { component: editor, basis: 3 },
    ]),
  );
  tui.setFocus(editor);
  const dispose = installStickyPrompt(tui);
  tui.start();
  tui.renderNow();
  cleanups.push(() => {
    dispose();
    tui.stop();
  });
  const screen = () => tui.getScreenLines().map((line) => stripTerminalSequences(line).trimEnd());
  const scroll = (top: number) => {
    view.scrollTo(top);
    tui.renderNow();
    return screen();
  };
  const userHeight = (index: number) => users[index].render(view.getContentWidth(terminal.columns)).length;
  const firstEnd = () => 1 + userHeight(0);
  const secondStart = () => firstEnd() + 40;
  const marker = () => {
    const lines = screen();
    const row = lines.findIndex((line) => line.includes("▲"));
    if (row < 0) throw new Error("Jump marker is not visible");
    return { x: lines[row].indexOf("▲") + 1, y: row + 1 };
  };
  const clickMarker = () => {
    const { x, y } = marker();
    input(`\x1b[<0;${x};${y}M`);
    input(`\x1b[<0;${x};${y}m`);
    tui.renderNow();
  };
  return {
    tui,
    view,
    terminal,
    chat,
    users,
    responses,
    editor,
    dispose,
    screen,
    scroll,
    input: (data: string) => input(data),
    firstEnd,
    secondStart,
    marker,
    clickMarker,
  };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("sticky turn prompts", () => {
  test("pins the current turn on the first frame and switches when reading older replies", () => {
    const { tui, view, screen, scroll, firstEnd } = setup();
    expect(screen()[0]).toContain("Second prompt");
    expect(screen().slice(-3)).toEqual(["Editor", "Footer", "Status"]);
    expect(scroll(firstEnd() + 4)[0]).toContain("First prompt");
    expect(view.isFollowingEnd).toBe(false);
    tui.scrollToBottom();
    tui.renderNow();
    expect(screen()[0]).toContain("Second prompt");
    expect(view.isFollowingEnd).toBe(true);
  });

  test("keeps all prompt lines fixed as the original crosses the top in either direction", () => {
    const { scroll, firstEnd, terminal } = setup(["Prompt line 1  \nPrompt line 2  \nPrompt line 3"]);
    const body = (lines: string[], offset = 0) =>
      lines.slice(offset, offset + 3).map((line) => line.slice(0, terminal.columns - 1).trimEnd());
    const original = body(scroll(1), 1);
    expect(original.map((line) => line.trim())).toEqual(["Prompt line 1", "Prompt line 2", "Prompt line 3"]);
    for (let top = 2; top <= firstEnd() + 3; top++) {
      const lines = scroll(top);
      expect(body(lines)).toEqual(original);
      expect(lines[3]).toContain("▲");
      expect(lines.filter((line) => line.includes("Prompt line 3"))).toHaveLength(1);
    }
    for (let top = firstEnd() + 3; top >= 2; top--) expect(body(scroll(top))).toEqual(original);
    expect(body(scroll(1), 1)).toEqual(original);
    expect(scroll(0).join("\n")).not.toContain("▲");
  });

  test("yields the entire pin before it could cover the following user block", () => {
    const { scroll, secondStart, firstEnd } = setup([
      "First line 1  \nFirst line 2  \nFirst line 3",
      "Second line 1  \nSecond line 2  \nSecond line 3",
    ]);
    const next = secondStart();
    const both = scroll(next - 8);
    expect(both[0]).toContain("First line 1");
    expect(both.filter((line) => line.includes("Second line 1"))).toHaveLength(1);
    const touching = scroll(next - 4);
    expect(touching[0]).toContain("First line 1");
    expect(touching[5]).toContain("Second line 1");
    for (let distance = 3; distance >= 0; distance--) {
      const lines = scroll(next - distance);
      expect(lines.join("\n")).not.toContain("First line");
      expect(lines.join("\n")).not.toContain("▲");
      expect(lines[distance + 1]).toContain("Second line 1");
      expect(lines[distance + 2]).toContain("Second line 2");
      expect(lines[distance + 3]).toContain("Second line 3");
    }
    for (let offset = 1; offset < firstEnd(); offset++) {
      const lines = scroll(next + offset);
      expect(lines[0]).toContain("Second line 1");
      expect(lines[1]).toContain("Second line 2");
      expect(lines[2]).toContain("Second line 3");
      expect(lines[3]).toContain("▲");
    }
  });

  test("hides the original tail of a long pinned prompt and reveals it through the arrow", () => {
    const text = Array.from({ length: 8 }, (_, index) => `Long prompt line ${index + 1}`).join("  \n");
    const { scroll, firstEnd, clickMarker, view, screen } = setup([text]);
    for (let top = 2; top <= firstEnd(); top++) {
      const lines = scroll(top);
      expect(lines[0]).toContain("Long prompt line 1");
      expect(lines[1]).toContain("Long prompt line 2");
      expect(lines[2]).toContain("Long prompt line 3");
      expect(lines[2]).toContain("…");
      for (let index = 4; index <= 8; index++) expect(lines.join("\n")).not.toContain(`Long prompt line ${index}`);
    }
    scroll(2);
    clickMarker();
    expect(view.scrollTop).toBe(1);
    expect(screen().join("\n")).not.toContain("▲");
    for (let index = 1; index <= 8; index++) expect(screen().join("\n")).toContain(`Long prompt line ${index}`);
  });

  test("uses the current layout after streaming, resizing, and transcript replacement", () => {
    const { tui, terminal, chat, responses, screen, scroll, firstEnd } = setup();
    const top = firstEnd() + 5;
    expect(scroll(top)[0]).toContain("First prompt");
    responses[1].setText("More streaming output\n".repeat(80));
    tui.renderNow();
    expect(tui.viewportTop).toBe(top);
    expect(screen()[0]).toContain("First prompt");
    terminal.columns = 24;
    tui.renderNow();
    expect(screen()[0]).toContain("First prompt");
    chat.clear();
    chat.addChild(new UserMessageComponent("New branch"));
    chat.addChild(new Text("Branch reply\n".repeat(40), 0, 0));
    tui.scrollToBottom();
    tui.renderNow();
    expect(screen()[0]).toContain("New branch");
    expect(screen().join("\n")).not.toContain("First prompt");
  });

  test("bounds long Unicode prompts and preserves the scrollbar at narrow widths", () => {
    const { tui, terminal, screen, users } = setup(
      ["中文提示 e\u0301\n\n第二段内容\n\n第三段内容\n\n第四段内容\n\n第五段内容"],
      24,
    );
    const natural = users[0].render(23);
    expect(screen()[0]).toContain("中文提示");
    expect(screen()[2]).toContain("…");
    expect(screen()[3]).toMatch(/^ +▲ +[│┃█]$/);
    expect(natural.some((line) => line.includes("第五段"))).toBe(true);
    for (const columns of [1, 2, 8, 24, 80]) {
      terminal.columns = columns;
      tui.renderNow();
      for (const line of tui.getScreenLines()) expect(visibleWidth(line)).toBeLessThanOrEqual(columns);
    }
    terminal.rows = 6;
    tui.renderNow();
    expect(screen().join("\n")).not.toContain("▲");
  });

  test("reuses rendered lines without rerendering replies or capturing editor input", () => {
    const { tui, responses, editor, input, screen } = setup();
    const renders = responses.map((response) => vi.spyOn(response, "render"));
    tui.renderNow();
    for (const render of renders) expect(render).toHaveBeenCalledTimes(1);
    expect(tui.hasOverlay()).toBe(false);
    input("x");
    expect(editor.handleInput).toHaveBeenCalledWith("x");
    const before = tui.viewportTop;
    input("\x1b[<64;4;1M");
    tui.renderNow();
    expect(tui.viewportTop).toBeLessThan(before);
    expect(screen()[0]).toContain("Second prompt");
  });

  test("keeps the scrollbar draggable and yields to overlays and transcript selection", () => {
    const { tui, terminal, screen, input, scroll, firstEnd } = setup();
    scroll(firstEnd() + 5);
    const beforeDrag = tui.viewportTop;
    input(`\x1b[<0;${terminal.columns};2M`);
    input(`\x1b[<32;${terminal.columns};12M`);
    input(`\x1b[<0;${terminal.columns};12m`);
    tui.renderNow();
    expect(tui.viewportTop).not.toBe(beforeDrag);

    scroll(firstEnd() + 5);
    const overlay = tui.showOverlay(new Text("Dialog", 0, 0), { anchor: "top-left", width: 12 });
    tui.renderNow();
    expect(screen()[0]).toContain("Dialog");
    expect(screen()[0]).not.toContain("First prompt");
    overlay.hide();
    tui.renderNow();
    expect(screen()[0]).toContain("First prompt");

    input("\x1b[<0;2;5M");
    input("\x1b[<32;8;6M");
    tui.renderNow();
    expect(tui.hasActiveSelection()).toBe(true);
    expect(screen().join("\n")).not.toContain("First prompt");
    tui.resetTextSelection();
    tui.renderNow();
    expect(screen()[0]).toContain("First prompt");
  });

  test("does not keep a stale prompt when a branch has no user messages", () => {
    const { tui, chat, screen } = setup();
    chat.clear();
    chat.addChild(new Text("Compaction summary\n".repeat(40), 0, 0));
    tui.renderNow();
    expect(screen()[0]).toContain("Compaction summary");
    expect(screen().join("\n")).not.toContain("prompt");
  });

  test("releases the hook on disposal and installs cleanly again", () => {
    const { tui, dispose, screen } = setup();
    dispose();
    dispose();
    tui.renderNow();
    expect(screen().join("\n")).not.toContain("Second prompt");
    const remove = installStickyPrompt(tui);
    tui.renderNow();
    expect(screen()[0]).toContain("Second prompt");
    remove();
  });

  test("keeps the prompt left-aligned and centers the arrow after resizing", () => {
    const { tui, view, screen, users, terminal, marker } = setup();
    const original = users[1]
      .render(terminal.columns - 1)
      .map(stripTerminalSequences)
      .find((line) => line.includes("Second prompt"));
    if (!original) throw new Error("Missing original prompt");
    for (const columns of [24, 25, 60, 61]) {
      terminal.columns = columns;
      tui.renderNow();
      expect(screen()[0].indexOf("Second prompt")).toBe(original.indexOf("Second prompt"));
      const { x, y } = marker();
      const left = x - 1;
      const right = view.getContentWidth(columns) - x;
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
      expect(y).toBe(2);
      expect(screen()[2]).toContain("Reply 2");
    }
  });

  test("clicks through to the correct occurrence of repeated prompts without taking editor focus", () => {
    const { tui, view, terminal, screen, scroll, firstEnd, secondStart, clickMarker, input, editor } = setup([
      "Continue",
      "Continue",
    ]);
    clickMarker();
    expect(view.scrollTop).toBe(secondStart());
    expect(view.isFollowingEnd).toBe(false);
    expect(screen().join("\n")).not.toContain("▲");
    expect(screen().filter((line) => line.includes("Continue"))).toHaveLength(1);
    expect(tui.hasActiveSelection()).toBe(false);
    terminal.columns = 25;
    scroll(firstEnd() + 5);
    clickMarker();
    expect(view.scrollTop).toBe(1);
    input("x");
    expect(editor.handleInput).toHaveBeenCalledWith("x");
    expect(tui.hasOverlay()).toBe(false);
  });

  test("limits clicking to the arrow cell and lets wheel events scroll over it", () => {
    const { tui, view, input, marker } = setup();
    const { x, y } = marker();
    const before = view.scrollTop;
    input(`\x1b[<0;${x + 1};${y}M`);
    input(`\x1b[<0;${x + 1};${y}m`);
    tui.renderNow();
    expect(view.scrollTop).toBe(before);
    input(`\x1b[<2;${x};${y}M`);
    input(`\x1b[<2;${x};${y}m`);
    expect(view.scrollTop).toBe(before);
    input(`\x1b[<64;${x};${y}M`);
    tui.renderNow();
    expect(view.scrollTop).toBeLessThan(before);
  });

  test("does not jump after dragging away from the arrow or replacing the pressed turn", () => {
    const { tui, view, input, marker, chat, screen } = setup();
    const { x, y } = marker();
    const before = view.scrollTop;
    input(`\x1b[<0;${x};${y}M`);
    input(`\x1b[<32;${x + 3};${y}M`);
    input(`\x1b[<0;${x + 3};${y}m`);
    tui.renderNow();
    expect(view.scrollTop).toBe(before);
    expect(tui.hasActiveSelection()).toBe(false);

    input(`\x1b[<0;${x};${y}M`);
    chat.clear();
    chat.addChild(new UserMessageComponent("Replacement turn"));
    chat.addChild(new Text("New reply\n".repeat(100), 0, 0));
    tui.renderNow();
    const replacedTop = view.scrollTop;
    expect(screen()[0]).toContain("Replacement turn");
    input(`\x1b[<0;${x};${y}m`);
    tui.renderNow();
    expect(view.scrollTop).toBe(replacedTop);
  });

  test("clears a pending click when disposed", () => {
    const { tui, view, dispose, input, marker, screen } = setup();
    const { x, y } = marker();
    const before = view.scrollTop;
    input(`\x1b[<0;${x};${y}M`);
    dispose();
    input(`\x1b[<0;${x};${y}m`);
    tui.renderNow();
    expect(view.scrollTop).toBe(before);
    expect(screen().join("\n")).not.toContain("▲");
  });

  test("leaves regular terminal mode unchanged", () => {
    const { terminal } = setup();
    const regular = new TuiMainScreen(terminal);
    const render = vi.spyOn(regular, "requestRender");
    installStickyPrompt(regular)();
    expect(render).not.toHaveBeenCalled();
    expect(regular.hasOverlay()).toBe(false);
  });
});
