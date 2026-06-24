import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetState } from "../src/state/store.ts";
import { registerTodoTool } from "../src/todo.ts";
import { TodoOverlay } from "../src/todo-overlay.ts";
import type { TaskAction } from "../src/tool/types.ts";
import { createMockPi, createMockUI, identityTheme } from "./helpers.ts";

async function setup(actions: Array<{ action: TaskAction; [k: string]: unknown }>) {
  __resetState();
  const { pi, tools } = createMockPi();
  registerTodoTool(pi);
  const tool = tools.get("todo")!;
  const execute = tool.execute as (...args: unknown[]) => Promise<unknown>;
  for (const p of actions) {
    await execute("tc", p, undefined, undefined, {});
  }
  const { ui, setWidget } = createMockUI();
  const overlay = new TodoOverlay();
  overlay.setUICtx(ui);
  overlay.update();
  const factory = setWidget.mock.calls[0][1] as (
    tui: { requestRender: () => void },
    theme: typeof identityTheme,
  ) => { render: (w: number) => string[]; invalidate: () => void };
  const widget = factory({ requestRender: vi.fn() }, identityTheme);
  return { widget, tool, ui, overlay };
}

beforeEach(() => {
  __resetState();
});
afterEach(() => {
  __resetState();
  vi.restoreAllMocks();
});

describe("TodoOverlay — heading", () => {
  it("includes 'Todos (completed/total)' count", async () => {
    const { widget } = await setup([
      { action: "create", subject: "a" },
      { action: "create", subject: "b" },
      { action: "update", id: 1, status: "completed" },
    ]);
    const lines = widget.render(200);
    expect(lines[0]).toContain("Todos (1/2)");
  });

  it("uses filled icon '●' when any task is active (pending/in_progress)", async () => {
    const { widget } = await setup([{ action: "create", subject: "a" }]);
    expect(widget.render(200)[0]).toContain("●");
  });

  it("uses hollow icon '○' when all tasks are completed", async () => {
    const { widget } = await setup([
      { action: "create", subject: "a" },
      { action: "update", id: 1, status: "completed" },
    ]);
    expect(widget.render(200)[0]).toContain("○");
  });
});

describe("TodoOverlay — natural-order rendering (no overflow)", () => {
  it("renders one line per visible task plus heading, last row uses '└─'", async () => {
    const { widget } = await setup([
      { action: "create", subject: "a" },
      { action: "create", subject: "b" },
      { action: "create", subject: "c" },
    ]);
    const lines = widget.render(200);
    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain("├─");
    expect(lines[2]).toContain("├─");
    expect(lines[3]).toContain("└─");
    expect(lines[4]).toBe("");
  });

  it("omits deleted tasks from the rendered output", async () => {
    const { widget } = await setup([
      { action: "create", subject: "visible" },
      { action: "create", subject: "gone" },
      { action: "update", id: 2, status: "deleted" },
    ]);
    const out = widget.render(200).join("\n");
    expect(out).toContain("visible");
    expect(out).not.toContain("gone");
  });
});

describe("TodoOverlay — per-task formatting", () => {
  it("pending task uses '○' glyph", async () => {
    const { widget } = await setup([{ action: "create", subject: "pending-task" }]);
    expect(widget.render(200)[1]).toContain("○");
    expect(widget.render(200)[1]).toContain("pending-task");
  });

  it("in_progress task uses '◐' glyph and appends (activeForm)", async () => {
    const { widget } = await setup([
      { action: "create", subject: "do it", activeForm: "Doing it" },
      { action: "update", id: 1, status: "in_progress" },
    ]);
    const line = widget.render(200)[1];
    expect(line).toContain("◐");
    expect(line).toContain("do it");
    expect(line).toContain("(Doing it)");
  });

  it("completed task stays visible until the next agent turn starts", async () => {
    const { widget, overlay } = await setup([
      { action: "create", subject: "done" },
      { action: "update", id: 1, status: "completed" },
    ]);
    const firstRender = widget.render(200);
    expect(firstRender[1]).toContain("✓");
    expect(firstRender[1]).toContain("done");
    expect(widget.render(200)[1]).toContain("done");
    overlay.hideCompletedTasksFromPreviousTurn();
    expect(widget.render(200)).toEqual([]);
  });
});

describe("TodoOverlay — showIds gate", () => {
  it("does NOT show #id prefix when no task has blockedBy", async () => {
    const { widget } = await setup([
      { action: "create", subject: "a" },
      { action: "create", subject: "b" },
    ]);
    const out = widget.render(200).join("\n");
    expect(out).not.toMatch(/#\d/);
  });

  it("shows #id prefix and '⛓' dep suffix when any task has blockedBy", async () => {
    const { widget } = await setup([
      { action: "create", subject: "base" },
      { action: "create", subject: "follow-up", blockedBy: [1] },
    ]);
    const out = widget.render(200).join("\n");
    expect(out).toContain("#1");
    expect(out).toContain("#2");
    expect(out).toContain("⛓");
  });
});

describe("TodoOverlay — overflow collapse", () => {
  it("drops completed first when dropping is enough", async () => {
    const actions: Array<{ action: TaskAction; [k: string]: unknown }> = [];
    for (let i = 1; i <= 8; i++) actions.push({ action: "create", subject: `p${i}` });
    for (let i = 9; i <= 12; i++) {
      actions.push({ action: "create", subject: `c${i}` });
      actions.push({ action: "update", id: i, status: "completed" });
    }
    const { widget } = await setup(actions);
    const lines = widget.render(200);
    expect(lines).toHaveLength(13);
    for (let i = 1; i <= 8; i++) expect(lines.join("\n")).toContain(`p${i}`);
    expect(lines[lines.length - 1]).toBe("");
    expect(lines[lines.length - 2]).toContain("+2 more");
    expect(lines[lines.length - 2]).toContain("2 completed");
  });

  it("truncates pending tail when dropping all completed isn't enough", async () => {
    const actions: Array<{ action: TaskAction; [k: string]: unknown }> = [];
    for (let i = 1; i <= 12; i++) actions.push({ action: "create", subject: `t${i}` });
    const { widget } = await setup(actions);
    const lines = widget.render(200);
    expect(lines).toHaveLength(13);
    expect(lines[lines.length - 1]).toBe("");
    const summary = lines[lines.length - 2];
    expect(summary).toContain("+2 more");
    expect(summary).toContain("2 pending");
    expect(summary).not.toContain("completed");
  });

  it("summary contains both 'completed' and 'pending' when mixed overflow", async () => {
    const actions: Array<{ action: TaskAction; [k: string]: unknown }> = [];
    for (let i = 1; i <= 12; i++) actions.push({ action: "create", subject: `p${i}` });
    for (let i = 13; i <= 15; i++) {
      actions.push({ action: "create", subject: `c${i}` });
      actions.push({ action: "update", id: i, status: "completed" });
    }
    const { widget } = await setup(actions);
    const summary = widget.render(200).slice(-2)[0];
    expect(summary).toContain("+5 more");
    expect(summary).toContain("3 completed");
    expect(summary).toContain("2 pending");
  });

  it("hides overflowed completed tasks on the next agent turn too", async () => {
    const actions: Array<{ action: TaskAction; [k: string]: unknown }> = [];
    for (let i = 1; i <= 11; i++) actions.push({ action: "create", subject: `p${i}` });
    for (let i = 12; i <= 16; i++) {
      actions.push({ action: "create", subject: `c${i}` });
      actions.push({ action: "update", id: i, status: "completed" });
    }
    const { widget, overlay } = await setup(actions);
    const beforeNextTurn = widget.render(200).join("\n");
    expect(beforeNextTurn).toContain("Todos (5/16)");
    expect(beforeNextTurn).toContain("+6 more");
    expect(beforeNextTurn).toContain("5 completed");
    overlay.hideCompletedTasksFromPreviousTurn();
    const afterNextTurn = widget.render(200).join("\n");
    expect(afterNextTurn).toContain("Todos (0/11)");
    expect(afterNextTurn).toContain("p11");
    expect(afterNextTurn).not.toContain("+1 more");
    expect(afterNextTurn).not.toContain("completed");
  });

  it("does not engage overflow at exactly 11 visible tasks", async () => {
    const actions: Array<{ action: TaskAction; [k: string]: unknown }> = [];
    for (let i = 1; i <= 11; i++) actions.push({ action: "create", subject: `t${i}` });
    const { widget } = await setup(actions);
    const lines = widget.render(200);
    expect(lines).toHaveLength(13);
    expect(lines[lines.length - 1]).toBe("");
    expect(lines[lines.length - 2]).not.toContain("+");
    expect(lines[lines.length - 2]).toContain("└─");
  });
});

describe("TodoOverlay — width truncation", () => {
  it("renders without throwing at small widths", async () => {
    const { widget } = await setup([
      {
        action: "create",
        subject: "a very long subject that would overflow a narrow column",
      },
    ]);
    expect(() => widget.render(20)).not.toThrow();
  });

  it("drops completed tasks from counts after the next agent turn starts", async () => {
    const { widget, overlay } = await setup([
      { action: "create", subject: "done" },
      { action: "update", id: 1, status: "completed" },
      { action: "create", subject: "next" },
    ]);
    expect(widget.render(200).join("\n")).toContain("Todos (1/2)");
    const secondRender = widget.render(200).join("\n");
    expect(secondRender).toContain("Todos (1/2)");
    expect(secondRender).toContain("next");
    expect(secondRender).toContain("done");
    overlay.hideCompletedTasksFromPreviousTurn();
    const hiddenRender = widget.render(200).join("\n");
    expect(hiddenRender).toContain("Todos (0/1)");
    expect(hiddenRender).toContain("next");
    expect(hiddenRender).not.toContain("done");
  });

  it("re-renders reflect live state changes without re-registering", async () => {
    const { widget, tool } = await setup([{ action: "create", subject: "first" }]);
    const out1 = widget.render(200).join("\n");
    expect(out1).toContain("first");
    const execute = tool.execute as (...args: unknown[]) => Promise<unknown>;
    await execute("tc", { action: "create", subject: "second" }, undefined, undefined, {});
    const out2 = widget.render(200).join("\n");
    expect(out2).toContain("first");
    expect(out2).toContain("second");
  });
});
