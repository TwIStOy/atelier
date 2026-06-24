import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetState } from "../state/store.ts";
import { DEFAULT_PROMPT_GUIDELINES, DEFAULT_PROMPT_SNIPPET, registerTodoTool } from "../todo.ts";
import type { TaskDetails } from "../tool/types.ts";

function setup() {
  __resetState();
  const { pi, tools } = (() => {
    const captured: Record<string, unknown>[] = [];
    const mockPi = {
      registerTool(tool: Record<string, unknown>) {
        captured.push(tool);
      },
      registerCommand: () => {},
      on: () => {},
    };
    return { pi: mockPi as never, tools: captured };
  })();
  registerTodoTool(pi);
  const tool = tools[0];
  if (!tool) throw new Error("tool not registered");
  return { tool };
}

async function call(tool: Record<string, unknown>, params: Record<string, unknown>) {
  const execute = tool.execute as Function;
  return execute("tc", params, undefined, undefined, {});
}

beforeEach(() => {
  __resetState();
});
afterEach(() => {
  __resetState();
});

describe("registerTodoTool — registration shape", () => {
  it("registers under the tool name 'todo' with the expected label and guidelines", () => {
    const { tool } = setup();
    expect(tool.name).toBe("todo");
    expect(tool.label).toBe("Todo");
    expect(tool.promptSnippet).toContain("task list");
    expect(Array.isArray(tool.promptGuidelines)).toBe(true);
    expect((tool.promptGuidelines as string[]).length).toBeGreaterThan(0);
  });

  it("exposes a typebox parameters schema declaring the six actions", () => {
    const { tool } = setup();
    const raw = JSON.stringify(tool.parameters);
    for (const action of ["create", "update", "list", "get", "delete", "clear"]) {
      expect(raw).toContain(action);
    }
  });

  it("promptSnippet defaults to DEFAULT_PROMPT_SNIPPET when no config", () => {
    const { tool } = setup();
    expect(tool.promptSnippet).toBe(DEFAULT_PROMPT_SNIPPET);
  });

  it("promptGuidelines default to DEFAULT_PROMPT_GUIDELINES when no config", () => {
    const { tool } = setup();
    expect(tool.promptGuidelines).toEqual(DEFAULT_PROMPT_GUIDELINES);
  });
});

describe("registerTodoTool — execute mutates module state", () => {
  it("create → list returns the seeded row", async () => {
    const { tool } = setup();
    const r1 = await call(tool, { action: "create", subject: "first" });
    expect((r1.details as TaskDetails).action).toBe("create");
    const r2 = await call(tool, { action: "list" });
    expect(r2.content[0]).toMatchObject({
      text: expect.stringContaining("first"),
    });
  });

  it("clear resets module state and nextId", async () => {
    const { tool } = setup();
    await call(tool, { action: "create", subject: "a" });
    await call(tool, { action: "create", subject: "b" });
    const r = await call(tool, { action: "clear" });
    const d = r.details as TaskDetails;
    expect(d.tasks).toEqual([]);
    expect(d.nextId).toBe(1);
  });
});
