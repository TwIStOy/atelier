import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import type { QueuedMessage } from "../src/queue.ts";
import { createQueuePanel, type QueueAction } from "../src/queue-panel.ts";
import { renderQueueWidget } from "../src/queue-widget.ts";

const theme: Theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

const tui = { requestRender: () => {} } as unknown as TUI;
const keybindings = { matches: () => false } as unknown as KeybindingsManager;

function msg(text: string): QueuedMessage {
  return { text, images: undefined, queuedAt: Date.now() };
}

describe("renderQueueWidget", () => {
  it("renders one badge-prefixed line per short message", () => {
    const lines = renderQueueWidget([msg("hello"), msg("world")], theme, 40);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("💬 #1");
    expect(lines[0]).toContain("hello");
    expect(lines[1]).toContain("💬 #2");
  });

  it("caps output at the widget line budget", () => {
    const many = Array.from({ length: 8 }, (_, i) => msg(`message ${i + 1} `.repeat(10)));
    const lines = renderQueueWidget(many, theme, 30);
    expect(lines.length).toBeLessThanOrEqual(8);
    expect(lines.at(-1)).toContain("…");
    expect(lines.join("\n")).not.toContain("message 8");
  });
});

describe("createQueuePanel", () => {
  function panel(messages: QueuedMessage[], actions: QueueAction[], deleted: number[]) {
    const panel = createQueuePanel(
      () => messages,
      (idx) => deleted.push(idx),
      theme,
      tui,
      keybindings,
      (a) => {
        actions.push(a);
      },
    );
    return panel;
  }

  it("closes on escape", () => {
    const actions: QueueAction[] = [];
    const p = panel([msg("a")], actions, []);
    p.handleInput("\x1b");
    expect(actions).toEqual([{ kind: "close" }]);
  });

  it("closes when the queue empties", () => {
    const actions: QueueAction[] = [];
    const p = panel([], actions, []);
    p.handleInput("x");
    expect(actions).toEqual([{ kind: "close" }]);
  });

  it("moves down then sends the selected message on enter", () => {
    const actions: QueueAction[] = [];
    const p = panel([msg("first"), msg("second")], actions, []);
    p.handleInput("j");
    p.handleInput("\r");
    expect(actions).toEqual([{ kind: "send", index: 1 }]);
  });

  it("deletes the selected message on d", () => {
    const actions: QueueAction[] = [];
    const deleted: number[] = [];
    const p = panel([msg("first"), msg("second")], actions, deleted);
    p.handleInput("d");
    expect(deleted).toEqual([0]);
    expect(actions).toEqual([]);
  });

  it("renders a bordered list with the selection bullet on the first row", () => {
    const p = panel([msg("only")], [], []);
    const lines = p.render(30);
    expect(lines[0]).toContain("┌");
    expect(lines[1]).toContain("Message Queue");
    expect(lines[2]).toContain("▸");
    expect(lines[2]).toContain("only");
    expect(lines.at(-1)).toContain("└");
  });
});
