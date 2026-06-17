import { describe, it, expect, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { SubagentViewerOverlay } from "./overlay.ts";
import type { SubagentRunSummary } from "./index.ts";

const ESC = "\u001b";
const ARROW_LEFT = "\u001b[D";
const ARROW_RIGHT = "\u001b[C";
const ARROW_DOWN = "\u001b[B";
const ARROW_UP = "\u001b[A";
const TAB = "\t";

function makeRun(
  id: string,
  label: string,
  running = false,
): SubagentRunSummary {
  return {
    id,
    subSessionFile: `/tmp/nonexistent-${id}.jsonl`,
    toolCalls: 3,
    endedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    model: "test/model",
    thinking: "medium",
    cwd: "/tmp",
    firstUserText: label,
    label,
    running,
  };
}

function makeTui(): TUI {
  return {
    requestRender: vi.fn(),
    terminal: { rows: 24, columns: 80 },
  } as unknown as TUI;
}

function makeTheme(): Theme {
  return {
    fg: (_c: string, t: string) => t,
    bg: (_c: string, t: string) => t,
  } as unknown as Theme;
}

const PARAM_BASE = {
  tui: makeTui(),
  theme: makeTheme(),
  parentSessionId: "test-parent",
  renderOptions: { expanded: true, hideThinkingBlock: false },
} as const;

describe("SubagentViewerOverlay navigation", () => {
  it("Esc triggers done action", () => {
    let action = "none";
    const overlay = new SubagentViewerOverlay({
      ...PARAM_BASE,
      runs: [makeRun("a", "Run A")],
      initialIndex: 0,
      onAction: (a) => {
        action = a;
      },
    });
    overlay.handleInput(ESC);
    expect(action).toBe("done");
    overlay.dispose();
  });

  it("Tab triggers picker action", () => {
    let action = "none";
    const overlay = new SubagentViewerOverlay({
      ...PARAM_BASE,
      runs: [makeRun("a", "Run A"), makeRun("b", "Run B")],
      initialIndex: 0,
      onAction: (a) => {
        action = a;
      },
    });
    overlay.handleInput(TAB);
    expect(action).toBe("picker");
    overlay.dispose();
  });

  it("right/left arrows cycle through runs (wrapping)", () => {
    const overlay = new SubagentViewerOverlay({
      ...PARAM_BASE,
      runs: [
        makeRun("a", "Run A"),
        makeRun("b", "Run B"),
        makeRun("c", "Run C"),
      ],
      initialIndex: 0,
      onAction: () => {},
    });
    const headerAt = () => overlay.render(80)[1] ?? "";
    const h0 = headerAt();
    overlay.handleInput(ARROW_RIGHT);
    const h1 = headerAt();
    expect(h1).not.toBe(h0);
    overlay.handleInput(ARROW_RIGHT);
    const h2 = headerAt();
    expect(h2).not.toBe(h1);
    overlay.handleInput(ARROW_RIGHT);
    const h3 = headerAt();
    expect(h3).toBe(h0);
    overlay.handleInput(ARROW_LEFT);
    expect(headerAt()).toBe(h2);
    overlay.dispose();
  });

  it("up/down adjust scroll offset without switching run", () => {
    const overlay = new SubagentViewerOverlay({
      ...PARAM_BASE,
      runs: [makeRun("a", "Run A")],
      initialIndex: 0,
      onAction: () => {},
    });
    expect(() => {
      overlay.handleInput(ARROW_DOWN);
      overlay.handleInput(ARROW_DOWN);
      overlay.handleInput(ARROW_UP);
      overlay.render(80);
    }).not.toThrow();
    overlay.dispose();
  });

  it("header shows a live tag for running runs", () => {
    const overlay = new SubagentViewerOverlay({
      ...PARAM_BASE,
      runs: [makeRun("a", "Run A", true)],
      initialIndex: 0,
      onAction: () => {},
    });
    const header = overlay.render(80).slice(0, 2).join("\n");
    expect(header).toContain("live");
    overlay.dispose();
  });

  it("render wraps content in a box border", () => {
    const overlay = new SubagentViewerOverlay({
      ...PARAM_BASE,
      runs: [makeRun("a", "Run A")],
      initialIndex: 0,
      onAction: () => {},
    });
    const lines = overlay.render(80);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("┌");
    expect(lines[0]).toContain("┐");
    expect(lines[lines.length - 1]).toContain("└");
    expect(lines[lines.length - 1]).toContain("┘");
    for (const line of lines.slice(1, lines.length - 1)) {
      expect(line).toContain("│");
    }
    overlay.dispose();
  });

  it("dispose stops the live-refresh interval", () => {
    const requestRender = vi.fn();
    const overlay = new SubagentViewerOverlay({
      tui: {
        requestRender,
        terminal: { rows: 24, columns: 80 },
      } as unknown as TUI,
      theme: makeTheme(),
      parentSessionId: "test-parent",
      runs: [makeRun("a", "Run A", true)],
      initialIndex: 0,
      renderOptions: { expanded: true, hideThinkingBlock: false },
      onAction: () => {},
    });
    overlay.dispose();
    const callsBefore = requestRender.mock.calls.length;
    expect(() => overlay.render(80)).not.toThrow();
    const callsAfter = requestRender.mock.calls.length;
    expect(callsAfter).toBe(callsBefore);
  });
});
