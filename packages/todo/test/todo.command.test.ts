import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetState } from "../src/state/store.ts";
import { registerTodosCommand, registerTodoTools } from "../src/todo.ts";
import { createMockCtx, createMockPi, dispatchTodoAction } from "./helpers.ts";

function setup() {
  __resetState();
  const { pi, tools, commands } = createMockPi();
  registerTodoTools(pi);
  registerTodosCommand(pi);
  const cmd = commands.get("todos");
  if (!cmd) throw new Error("command not registered");
  return { tools, cmd };
}

async function seed(tools: Map<string, Record<string, unknown>>, actions: Array<Record<string, unknown>>) {
  for (const p of actions) {
    await dispatchTodoAction(tools, p as { action: string } & Record<string, unknown>);
  }
}

function makeCtx(): ExtensionCommandContext {
  return createMockCtx({ hasUI: true }) as unknown as ExtensionCommandContext;
}

beforeEach(() => {
  __resetState();
});
afterEach(() => {
  __resetState();
});

describe("/todos command — registration", () => {
  it("registers a command named 'todos' with a description", () => {
    const { cmd } = setup();
    expect(cmd.description).toContain("todos");
  });
});

describe("/todos command — guard branches", () => {
  it("notifies an error when the session has no UI", async () => {
    const { cmd } = setup();
    const ctx = createMockCtx({
      hasUI: false,
    }) as unknown as ExtensionCommandContext;
    await cmd.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("interactive"), "error");
  });

  it("notifies an info message when there are no visible tasks", async () => {
    const { cmd } = setup();
    const ctx = makeCtx();
    await cmd.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("No todos"), "info");
  });

  it("treats all-deleted tasks as empty (info notify, not group render)", async () => {
    const { tools, cmd } = setup();
    await seed(tools, [
      { action: "create", subject: "a" },
      { action: "update", id: 1, status: "deleted" },
    ]);
    const ctx = makeCtx();
    await cmd.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("No todos"), "info");
  });
});

describe("/todos command — grouped output", () => {
  function grabOutput(ctx: ExtensionCommandContext): string {
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    const calls = (ctx.ui.notify as unknown as ReturnType<typeof import("vitest").vi.fn>).mock.calls;
    const [text, level] = calls[0];
    expect(level).toBe("info");
    return text as string;
  }

  it("renders 'Pending' group with ○ glyph and task id", async () => {
    const { tools, cmd } = setup();
    await seed(tools, [{ action: "create", subject: "research" }]);
    const ctx = makeCtx();
    await cmd.handler("", ctx);
    const out = grabOutput(ctx);
    expect(out).toContain("── Pending ──");
    expect(out).toContain("○ #1 research");
    expect(out).toContain("1 pending");
  });

  it("renders 'In Progress' group with ◐ glyph and activeForm suffix", async () => {
    const { tools, cmd } = setup();
    await seed(tools, [
      { action: "create", subject: "build", activeForm: "Building" },
      { action: "update", id: 1, status: "in_progress" },
    ]);
    const ctx = makeCtx();
    await cmd.handler("", ctx);
    const out = grabOutput(ctx);
    expect(out).toContain("── In Progress ──");
    expect(out).toContain("◐ #1 build (Building)");
    expect(out).toContain("1 in_progress");
  });

  it("renders 'Completed' group with ✓ glyph and 'N/M completed' header", async () => {
    const { tools, cmd } = setup();
    await seed(tools, [
      { action: "create", subject: "ship" },
      { action: "update", id: 1, status: "completed" },
    ]);
    const ctx = makeCtx();
    await cmd.handler("", ctx);
    const out = grabOutput(ctx);
    expect(out).toContain("── Completed ──");
    expect(out).toContain("✓ #1 ship");
    expect(out).toContain("1/1 completed");
  });

  it("emits the header parts in 'completed · in_progress · pending' order", async () => {
    const { tools, cmd } = setup();
    await seed(tools, [
      { action: "create", subject: "p" },
      { action: "create", subject: "ip" },
      { action: "update", id: 2, status: "in_progress" },
      { action: "create", subject: "done" },
      { action: "update", id: 3, status: "completed" },
    ]);
    const ctx = makeCtx();
    await cmd.handler("", ctx);
    const out = grabOutput(ctx);
    const header = out.split("\n")[0];
    const iC = header.indexOf("completed");
    const iIP = header.indexOf("in_progress");
    const iP = header.indexOf("pending");
    expect(iC).toBeGreaterThanOrEqual(0);
    expect(iIP).toBeGreaterThan(iC);
    expect(iP).toBeGreaterThan(iIP);
  });

  it("appends '⛓ #deps' suffix for tasks with blockedBy", async () => {
    const { tools, cmd } = setup();
    await seed(tools, [
      { action: "create", subject: "base" },
      { action: "create", subject: "follow-up", blockedBy: [1] },
    ]);
    const ctx = makeCtx();
    await cmd.handler("", ctx);
    const out = grabOutput(ctx);
    expect(out).toContain("⛓ #1");
  });

  it("omits deleted tombstones from the grouped output", async () => {
    const { tools, cmd } = setup();
    await seed(tools, [
      { action: "create", subject: "keep" },
      { action: "create", subject: "drop" },
      { action: "update", id: 2, status: "deleted" },
    ]);
    const ctx = makeCtx();
    await cmd.handler("", ctx);
    const out = grabOutput(ctx);
    expect(out).toContain("keep");
    expect(out).not.toContain("drop");
  });
});
