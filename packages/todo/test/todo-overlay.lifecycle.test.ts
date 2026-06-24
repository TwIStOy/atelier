import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetState } from "../state/store.ts";
import { registerTodoTool } from "../todo.ts";
import { TodoOverlay } from "../todo-overlay.ts";
import { createMockPi, createMockUI, identityTheme } from "./helpers.ts";

const WIDGET_KEY = "rpiv-todos";

async function seed(tools: Map<string, Record<string, unknown>>, actions: unknown[]) {
  const tool = tools.get("todo");
  if (!tool) throw new Error("todo tool not registered");
  const execute = tool.execute as Function;
  for (const p of actions) {
    await execute("tc", p, undefined, undefined, {});
  }
  return tool;
}

function makeCtx(): {
  ui: ExtensionUIContext;
  setWidget: ReturnType<typeof vi.fn>;
} {
  const { ui, setWidget } = createMockUI();
  return { ui, setWidget };
}

function registerTool() {
  const { pi, tools } = createMockPi();
  registerTodoTool(pi);
  return { tools };
}

beforeEach(() => {
  __resetState();
});
afterEach(() => {
  __resetState();
  vi.restoreAllMocks();
});

describe("TodoOverlay — lifecycle", () => {
  it("update() with no UI ctx bound is a no-op", () => {
    const overlay = new TodoOverlay();
    expect(() => overlay.update()).not.toThrow();
  });

  it("update() with empty todos does not register a widget", () => {
    const overlay = new TodoOverlay();
    const { ui, setWidget } = makeCtx();
    overlay.setUICtx(ui);
    overlay.update();
    expect(setWidget).not.toHaveBeenCalled();
  });

  it("first update() with non-empty todos registers the widget exactly once", async () => {
    const { tools } = registerTool();
    await seed(tools, [{ action: "create", subject: "a" }]);
    const overlay = new TodoOverlay();
    const { ui, setWidget } = makeCtx();
    overlay.setUICtx(ui);
    overlay.update();
    expect(setWidget).toHaveBeenCalledTimes(1);
    expect(setWidget.mock.calls[0][0]).toBe(WIDGET_KEY);
    expect(typeof setWidget.mock.calls[0][1]).toBe("function");
    expect(setWidget.mock.calls[0][2]).toEqual({ placement: "aboveEditor" });
  });

  it("second update() after registration calls tui.requestRender instead of re-registering", async () => {
    const { tools } = registerTool();
    await seed(tools, [{ action: "create", subject: "a" }]);
    const overlay = new TodoOverlay();
    const { ui, setWidget } = makeCtx();
    overlay.setUICtx(ui);
    overlay.update();
    const factory = setWidget.mock.calls[0][1] as (
      tui: { requestRender: () => void },
      theme: typeof identityTheme,
    ) => { render: (w: number) => string[]; invalidate: () => void };
    const tui = { requestRender: vi.fn() };
    factory(tui, identityTheme);
    overlay.update();
    expect(setWidget).toHaveBeenCalledTimes(1);
    expect(tui.requestRender).toHaveBeenCalledTimes(1);
  });

  it("transition non-empty → empty unregisters the widget", async () => {
    const { tools } = registerTool();
    const tool = await seed(tools, [{ action: "create", subject: "a" }]);
    const overlay = new TodoOverlay();
    const { ui, setWidget } = makeCtx();
    overlay.setUICtx(ui);
    overlay.update();
    const execute = tool.execute as Function;
    await execute("tc", { action: "clear" }, undefined, undefined, {});
    overlay.update();
    expect(setWidget).toHaveBeenCalledTimes(2);
    expect(setWidget.mock.calls[1]).toEqual([WIDGET_KEY, undefined]);
  });

  it("empty → non-empty after empty transition re-registers", async () => {
    const { tools } = registerTool();
    const tool = await seed(tools, [{ action: "create", subject: "a" }]);
    const overlay = new TodoOverlay();
    const { ui, setWidget } = makeCtx();
    overlay.setUICtx(ui);
    overlay.update();
    const execute = tool.execute as Function;
    await execute("tc", { action: "clear" }, undefined, undefined, {});
    overlay.update();
    await execute("tc", { action: "create", subject: "b" }, undefined, undefined, {});
    overlay.update();
    expect(setWidget).toHaveBeenCalledTimes(3);
    expect(typeof setWidget.mock.calls[2][1]).toBe("function");
  });

  it("setUICtx(same ctx) is idempotent", async () => {
    const { tools } = registerTool();
    await seed(tools, [{ action: "create", subject: "a" }]);
    const overlay = new TodoOverlay();
    const { ui, setWidget } = makeCtx();
    overlay.setUICtx(ui);
    overlay.update();
    overlay.setUICtx(ui);
    overlay.update();
    expect(setWidget).toHaveBeenCalledTimes(1);
  });

  it("setUICtx(different ctx) resets cached registration; next update re-registers under the new ctx", async () => {
    const { tools } = registerTool();
    await seed(tools, [{ action: "create", subject: "a" }]);
    const overlay = new TodoOverlay();
    const c1 = makeCtx();
    overlay.setUICtx(c1.ui);
    overlay.update();
    const c2 = makeCtx();
    overlay.setUICtx(c2.ui);
    overlay.update();
    expect(c1.setWidget).toHaveBeenCalledTimes(1);
    expect(c2.setWidget).toHaveBeenCalledTimes(1);
  });

  it("dispose() unregisters the widget and clears ctx; later update() without setUICtx is a no-op", async () => {
    const { tools } = registerTool();
    await seed(tools, [{ action: "create", subject: "a" }]);
    const overlay = new TodoOverlay();
    const { ui, setWidget } = makeCtx();
    overlay.setUICtx(ui);
    overlay.update();
    overlay.dispose();
    expect(setWidget).toHaveBeenCalledTimes(2);
    expect(setWidget.mock.calls[1]).toEqual([WIDGET_KEY, undefined]);
    overlay.update();
    expect(setWidget).toHaveBeenCalledTimes(2);
  });

  it("factory invalidate() forces re-registration on next update()", async () => {
    const { tools } = registerTool();
    await seed(tools, [{ action: "create", subject: "a" }]);
    const overlay = new TodoOverlay();
    const { ui, setWidget } = makeCtx();
    overlay.setUICtx(ui);
    overlay.update();
    const factory = setWidget.mock.calls[0][1] as (
      tui: { requestRender: () => void },
      theme: typeof identityTheme,
    ) => { render: (w: number) => string[]; invalidate: () => void };
    const widget = factory({ requestRender: vi.fn() }, identityTheme);
    widget.invalidate();
    overlay.update();
    expect(setWidget).toHaveBeenCalledTimes(2);
    expect(typeof setWidget.mock.calls[1][1]).toBe("function");
  });

  it("resetCompletedDisplayState() lets replayed completed tasks be shown once again", async () => {
    const { tools } = registerTool();
    await seed(tools, [
      { action: "create", subject: "done" },
      { action: "update", id: 1, status: "completed" },
    ]);
    const overlay = new TodoOverlay();
    const { ui, setWidget } = makeCtx();
    overlay.setUICtx(ui);
    overlay.update();
    const factory = setWidget.mock.calls[0][1] as (
      tui: { requestRender: () => void },
      theme: typeof identityTheme,
    ) => { render: (w: number) => string[]; invalidate: () => void };
    const widget = factory({ requestRender: vi.fn() }, identityTheme);
    expect(widget.render(200).join("\n")).toContain("done");
    overlay.hideCompletedTasksFromPreviousTurn();
    expect(widget.render(200)).toEqual([]);
    overlay.resetCompletedDisplayState();
    expect(widget.render(200).join("\n")).toContain("done");
  });

  it("hideCompletedTasksFromPreviousTurn() is a no-op when nothing is pending hide", () => {
    const overlay = new TodoOverlay();
    expect(() => overlay.hideCompletedTasksFromPreviousTurn()).not.toThrow();
  });

  it("all-deleted todos count as empty (no widget)", async () => {
    const { tools } = registerTool();
    const tool = await seed(tools, [{ action: "create", subject: "a" }]);
    const execute = tool.execute as Function;
    await execute("tc", { action: "update", id: 1, status: "deleted" }, undefined, undefined, {});
    const overlay = new TodoOverlay();
    const { ui, setWidget } = makeCtx();
    overlay.setUICtx(ui);
    overlay.update();
    expect(setWidget).not.toHaveBeenCalled();
  });
});
