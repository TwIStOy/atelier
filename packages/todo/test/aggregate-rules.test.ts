import { aggregateRuleFor, isExtensionDisabled, resetAggregateRulesForTest } from "@htwang-contrib/common";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@htwang-contrib/common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@htwang-contrib/common")>();
  return {
    ...actual,
    isExtensionDisabled: vi.fn(() => false),
  };
});

import initTodo from "../src/index.ts";
import { createMockPi } from "./helpers.ts";

afterEach(() => {
  resetAggregateRulesForTest();
  vi.mocked(isExtensionDisabled).mockReturnValue(false);
});

describe("todo aggregate rules", () => {
  it("registers todo rules when the extension loads", () => {
    initTodo(createMockPi().pi);

    expect(aggregateRuleFor("todo_create")).toEqual({
      verb: "Created",
      singular: "task",
      plural: "tasks",
      progressive: "Creating…",
    });
    expect(aggregateRuleFor("todo_update")).toEqual({
      verb: "Updated",
      singular: "task",
      plural: "tasks",
      progressive: "Updating…",
    });
    expect(aggregateRuleFor("todo_list")).toEqual({
      verb: "Listed",
      singular: "task list",
      plural: "task lists",
      progressive: "Listing…",
    });
    expect(aggregateRuleFor("todo_get")).toEqual({
      verb: "Read",
      singular: "task",
      plural: "tasks",
      progressive: "Reading…",
    });
    expect(aggregateRuleFor("todo_delete")).toEqual({
      verb: "Deleted",
      singular: "task",
      plural: "tasks",
      progressive: "Deleting…",
    });
    expect(aggregateRuleFor("todo_clear")).toEqual({
      verb: "Cleared",
      singular: "task list",
      plural: "task lists",
      progressive: "Clearing…",
    });
  });

  it("does not register rules when the extension is disabled", () => {
    vi.mocked(isExtensionDisabled).mockReturnValue(true);

    initTodo(createMockPi().pi);

    expect(aggregateRuleFor("todo_create")).toBeUndefined();
    expect(aggregateRuleFor("todo_update")).toBeUndefined();
    expect(aggregateRuleFor("todo_list")).toBeUndefined();
    expect(aggregateRuleFor("todo_get")).toBeUndefined();
    expect(aggregateRuleFor("todo_delete")).toBeUndefined();
    expect(aggregateRuleFor("todo_clear")).toBeUndefined();
  });

  it("is idempotent across re-entry", () => {
    const { pi } = createMockPi();
    initTodo(pi);
    expect(() => initTodo(pi)).not.toThrow();
    expect(aggregateRuleFor("todo_create")).toBeDefined();
  });

  it("resetAggregateRulesForTest drops todo rules", () => {
    initTodo(createMockPi().pi);
    resetAggregateRulesForTest();
    expect(aggregateRuleFor("todo_create")).toBeUndefined();
    expect(aggregateRuleFor("read")).toBeDefined();
  });
});
