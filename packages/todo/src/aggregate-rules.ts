import { registerAggregateRule } from "@htwang-contrib/common";
import { TODO_CLEAR, TODO_CREATE, TODO_DELETE, TODO_GET, TODO_LIST, TODO_UPDATE } from "./tool/types.ts";

const TODO_AGGREGATE_RULES = {
  [TODO_CREATE]: { verb: "Created", singular: "task", plural: "tasks", progressive: "Creating…" },
  [TODO_UPDATE]: { verb: "Updated", singular: "task", plural: "tasks", progressive: "Updating…" },
  [TODO_LIST]: { verb: "Listed", singular: "task list", plural: "task lists", progressive: "Listing…" },
  [TODO_GET]: { verb: "Read", singular: "task", plural: "tasks", progressive: "Reading…" },
  [TODO_DELETE]: { verb: "Deleted", singular: "task", plural: "tasks", progressive: "Deleting…" },
  [TODO_CLEAR]: { verb: "Cleared", singular: "task list", plural: "task lists", progressive: "Clearing…" },
} as const;

export function registerTodoAggregateRules(): void {
  for (const [toolName, rule] of Object.entries(TODO_AGGREGATE_RULES)) {
    registerAggregateRule(toolName, rule);
  }
}
