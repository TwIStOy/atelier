import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetState } from "../src/state/store.ts";
import { registerTodoTools } from "../src/todo.ts";
import { type TaskDetails, TODO_TOOL_NAMES } from "../src/tool/types.ts";
import { createMockPi, dispatchTodoAction } from "./helpers.ts";

function setup() {
  __resetState();
  const { pi, tools } = createMockPi();
  registerTodoTools(pi);
  return { tools };
}

interface TodoCallResult {
  content: Array<{ type: "text"; text: string }>;
  details: TaskDetails;
}

async function dispatch(
  tools: Map<string, Record<string, unknown>>,
  call: { action: string } & Record<string, unknown>,
): Promise<TodoCallResult> {
  return (await dispatchTodoAction(tools, call)) as TodoCallResult;
}

function requiredOf(tool: Record<string, unknown>): string[] {
  const params = tool.parameters as { required?: string[] };
  return [...(params.required ?? [])];
}

beforeEach(() => {
  __resetState();
});
afterEach(() => {
  __resetState();
});

describe("registerTodoTools — registration shape", () => {
  it("registers exactly the six per-action tools under todo_<action> names", () => {
    const { tools } = setup();
    expect([...tools.keys()].sort()).toEqual([...TODO_TOOL_NAMES].sort());
  });

  it("uses CamelCase labels and an empty-object schema for todo_clear", () => {
    const { tools } = setup();
    expect(tools.get("todo_create")?.label).toBe("Todo Create");
    expect(tools.get("todo_update")?.label).toBe("Todo Update");
    expect(tools.get("todo_list")?.label).toBe("Todo List");
    expect(tools.get("todo_get")?.label).toBe("Todo Get");
    expect(tools.get("todo_delete")?.label).toBe("Todo Delete");
    expect(tools.get("todo_clear")?.label).toBe("Todo Clear");
  });

  it("each tool exposes a promptSnippet and a promptGuidelines array", () => {
    const { tools } = setup();
    for (const name of TODO_TOOL_NAMES) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`${name} not registered`);
      expect(typeof tool.promptSnippet).toBe("string");
      expect((tool.promptSnippet as string).length).toBeGreaterThan(0);
      expect(Array.isArray(tool.promptGuidelines)).toBe(true);
    }
  });

  it("declares the correct required field per action", () => {
    const { tools } = setup();
    expect(requiredOf(tools.get("todo_create")!)).toEqual(["subject"]);
    expect(requiredOf(tools.get("todo_update")!)).toEqual(["id"]);
    expect(requiredOf(tools.get("todo_get")!)).toEqual(["id"]);
    expect(requiredOf(tools.get("todo_delete")!)).toEqual(["id"]);
    expect(requiredOf(tools.get("todo_list")!)).toEqual([]);
    expect(requiredOf(tools.get("todo_clear")!)).toEqual([]);
  });

  it("carries the legacy 'todo' toolName only via isTodoToolName (no tool named 'todo' is registered)", () => {
    const { tools } = setup();
    expect(tools.has("todo")).toBe(false);
  });
});

describe("registerTodoTools — execute mutates module state", () => {
  it("create -> list returns the seeded row", async () => {
    const { tools } = setup();
    const r1 = await dispatch(tools, { action: "create", subject: "first" });
    expect(r1.details.action).toBe("create");
    const r2 = await dispatch(tools, { action: "list" });
    expect(r2.content[0]).toMatchObject({
      text: expect.stringContaining("first"),
    });
  });

  it("clear resets module state and nextId", async () => {
    const { tools } = setup();
    await dispatch(tools, { action: "create", subject: "a" });
    await dispatch(tools, { action: "create", subject: "b" });
    const r = await dispatch(tools, { action: "clear" });
    const d = r.details;
    expect(d.tasks).toEqual([]);
    expect(d.nextId).toBe(1);
  });
});
