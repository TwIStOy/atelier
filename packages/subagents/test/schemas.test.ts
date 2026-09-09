import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { subagentParams } from "../src/schemas.ts";

const batchTask = { task: "batch task", description: "Batch task" };

describe("subagent schema", () => {
  it("keeps every root union branch object-typed for Grok", () => {
    const schema = subagentParams as { type?: unknown; oneOf?: Array<{ type?: unknown }> };

    expect(schema.type).toBe("object");
    expect(schema.oneOf).toHaveLength(2);
    for (const branch of schema.oneOf ?? []) {
      expect(branch.type).toBe("object");
    }
  });

  it("accepts single-task mode only", () => {
    expect(Check(subagentParams, { task: "single task", description: "Single task" })).toBe(true);
  });

  it("accepts batch mode only", () => {
    expect(Check(subagentParams, { tasks: [batchTask] })).toBe(true);
  });

  it("rejects task and tasks together", () => {
    expect(Check(subagentParams, { task: "single task", tasks: [batchTask] })).toBe(false);
  });

  it("rejects neither task nor tasks", () => {
    expect(Check(subagentParams, {})).toBe(false);
  });

  it("rejects empty or whitespace-only single tasks", () => {
    expect(Check(subagentParams, { task: "" })).toBe(false);
    expect(Check(subagentParams, { task: "   " })).toBe(false);
  });

  it("rejects empty batch tasks", () => {
    expect(Check(subagentParams, { tasks: [{ ...batchTask, task: "" }] })).toBe(false);
  });
});
