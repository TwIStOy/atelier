import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createStreamingWorkflowDisplay,
  createWidgetWorkflowDisplay,
  renderWorkflowLines,
  renderWorkflowLinesThemed,
} from "../src/display.ts";
import type { WorkflowSnapshot } from "../src/engine.ts";

type WidgetFactory = (tui: TUI, theme: Theme) => Component;

const IDENTITY_THEME = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const TAG_THEME = {
  fg: (color: string, text: string) => `[${color}]${text}[/]`,
  bold: (text: string) => `<b>${text}</b>`,
} as unknown as Theme;

function makeMockWidgetUi(calls: Array<string[] | undefined>) {
  return {
    setWidget: (_key: string, content: WidgetFactory | undefined, _options?: { placement?: string }) => {
      if (content === undefined) {
        calls.push(undefined);
        return;
      }
      const component = content({} as TUI, IDENTITY_THEME);
      calls.push(component.render(100));
    },
  };
}

function snapshot(over: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot {
  return {
    name: "audit",
    description: "d",
    status: "running",
    phases: [],
    agents: [],
    logs: [],
    startedAt: Date.now() - 5000,
    ...over,
  };
}

describe("renderWorkflowLines", () => {
  it("renders the header with counts", () => {
    const lines = renderWorkflowLines(
      snapshot({
        agents: [
          { id: 1, label: "one", phase: null, status: "done", toolCalls: 3, startedAt: 0 },
          { id: 2, label: "two", phase: null, status: "running", toolCalls: 1, startedAt: 0 },
        ],
      }),
    );
    expect(lines[0]).toMatch(/◆ Workflow: audit — running \(1\/2 agents, \d+s\)/);
    expect(lines[1]).toBe("  ✓ #1 one · 3 tool calls");
    expect(lines[2]).toBe("  ● #2 two · 1 tool calls");
  });

  it("renders phases with nested agents and error details", () => {
    const lines = renderWorkflowLines(
      snapshot({
        phases: [
          { title: "collect", status: "done", startedAt: 0, endedAt: 1 },
          { title: "synthesize", status: "active", startedAt: 1 },
        ],
        agents: [
          { id: 1, label: "scout", phase: "collect", status: "done", toolCalls: 0, startedAt: 0 },
          { id: 2, label: "critic", phase: "synthesize", status: "error", toolCalls: 5, detail: "boom", startedAt: 1 },
        ],
      }),
    );
    expect(lines).toEqual([
      expect.stringMatching(/^◆ Workflow: audit/),
      "  ✓ collect",
      "    ✓ #1 scout",
      "  ▶ synthesize",
      "    ✗ #2 critic · 5 tool calls · boom",
    ]);
  });

  it("appends recent logs, capped", () => {
    const lines = renderWorkflowLines(snapshot({ logs: ["a", "b", "c"] }));
    expect(lines.slice(-2)).toEqual(["  … b", "  … c"]);
  });
});

describe("renderWorkflowLinesThemed", () => {
  it("colors the header, phases, and agent glyphs", () => {
    const lines = renderWorkflowLinesThemed(
      snapshot({
        phases: [
          { title: "collect", status: "done", startedAt: 0, endedAt: 1 },
          { title: "synthesize", status: "active", startedAt: 1 },
        ],
        agents: [
          { id: 1, label: "scout", phase: "collect", status: "done", toolCalls: 3, startedAt: 0 },
          { id: 2, label: "critic", phase: "synthesize", status: "running", toolCalls: 1, startedAt: 1 },
        ],
      }),
      TAG_THEME,
    );
    expect(lines[0]).toContain("[toolTitle]<b>◆ Workflow: </b>[/]");
    expect(lines[0]).toContain("[accent]audit[/]");
    expect(lines[0]).toContain("[accent]running[/]");
    expect(lines[1]).toContain("[success]✓[/] [muted]collect[/]");
    expect(lines[2]).toContain("[success]✓[/] [toolOutput]#1 scout[/][dim] · 3 tool calls[/]");
    expect(lines[3]).toContain("[accent]▶[/] [toolOutput]synthesize[/]");
    expect(lines[4]).toMatch(/^\s+\[accent\].\[\/\] \[toolOutput\]#2 critic\[\/\]/);
  });

  it("colors error details", () => {
    const lines = renderWorkflowLinesThemed(
      snapshot({
        agents: [{ id: 1, label: "bad", phase: null, status: "error", toolCalls: 0, detail: "boom", startedAt: 0 }],
      }),
      TAG_THEME,
    );
    expect(lines[1]).toContain("[error]✗[/]");
    expect(lines[1]).toContain("[error] — boom[/]");
  });
});

describe("createWidgetWorkflowDisplay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pushes lines to the widget and clears after finish delay", () => {
    const calls: Array<string[] | undefined> = [];
    const ui = makeMockWidgetUi(calls);
    const display = createWidgetWorkflowDisplay(ui);
    display.update(snapshot());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.join("\n")).toContain("Workflow: audit");

    display.finish(snapshot({ status: "done" }));
    expect(calls).toHaveLength(2);
    vi.advanceTimersByTime(15_000);
    expect(calls).toHaveLength(3);
    expect(calls[2]).toBeUndefined();
  });

  it("throttles rapid updates with a trailing call", () => {
    const calls: Array<string[] | undefined> = [];
    const ui = makeMockWidgetUi(calls);
    const display = createWidgetWorkflowDisplay(ui);
    display.update(snapshot({ name: "first" }));
    display.update(snapshot({ name: "second" }));
    display.update(snapshot({ name: "third" }));
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(150);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.join("\n")).toContain("third");
  });

  it("re-renders once per second while running and stops after finish", () => {
    const calls: Array<string[] | undefined> = [];
    const ui = makeMockWidgetUi(calls);
    const display = createWidgetWorkflowDisplay(ui);
    display.update(snapshot());
    expect(calls).toHaveLength(1);

    vi.advanceTimersByTime(3_100);
    expect(calls.length).toBeGreaterThanOrEqual(4);

    display.finish(snapshot({ status: "done" }));
    const settled = calls.length;
    vi.advanceTimersByTime(3_000);
    expect(calls.length).toBe(settled);
  });

  it("does not tick when the run already ended", () => {
    const calls: Array<string[] | undefined> = [];
    const ui = makeMockWidgetUi(calls);
    const display = createWidgetWorkflowDisplay(ui);
    display.update(snapshot({ status: "done" }));
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(3_000);
    expect(calls).toHaveLength(1);
  });
});

describe("createStreamingWorkflowDisplay", () => {
  it("emits partial tool results", () => {
    const partials: string[] = [];
    const display = createStreamingWorkflowDisplay((partial) => {
      const text = partial.content[0];
      if (text.type === "text") partials.push(text.text);
    });
    display.update(snapshot());
    expect(partials).toHaveLength(1);
    expect(partials[0]).toContain("Workflow: audit");
  });

  it("is a no-op without onUpdate", () => {
    const display = createStreamingWorkflowDisplay(undefined);
    expect(() => display.update(snapshot())).not.toThrow();
  });
});
