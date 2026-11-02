import type { ExtensionAPI, ToolAnnotations } from "@earendil-works/pi-coding-agent";
import type { TObject } from "@sinclair/typebox";
import { loadConfig } from "./config.ts";
import { selectTasksByStatus, selectTodoCounts, selectVisibleTasks } from "./state/selectors.ts";
import { applyTaskMutation } from "./state/state-reducer.ts";
import { commitState, getState } from "./state/store.ts";
import { buildToolResult } from "./tool/response-envelope.ts";
import {
  ClearTodoSchema,
  COMMAND_NAME,
  CreateTodoSchema,
  DeleteTodoSchema,
  ERR_REQUIRES_INTERACTIVE,
  GetTodoOutputSchema,
  GetTodoSchema,
  ListTodoOutputSchema,
  ListTodoSchema,
  MSG_NO_TODOS,
  type TaskAction,
  type TaskMutationParams,
  TODO_CLEAR,
  TODO_CREATE,
  TODO_DELETE,
  TODO_GET,
  TODO_LIST,
  TODO_UPDATE,
  UpdateTodoSchema,
} from "./tool/types.ts";
import { formatCommandTaskLine, statusGlyph } from "./view/format.ts";

const SECTION_PENDING = "── Pending ──";
const SECTION_IN_PROGRESS = "── In Progress ──";
const SECTION_COMPLETED = "── Completed ──";

interface TodoToolSpec {
  action: TaskAction;
  name: string;
  label: string;
  description: string;
  snippet: string;
  guidelines: string[];
  parameters: TObject;
  outputSchema?: TObject;
  annotations: ToolAnnotations;
}

const TODO_TOOL_SPECS: TodoToolSpec[] = [
  {
    action: "create",
    name: TODO_CREATE,
    label: "Todo Create",
    description: "Create a new task in the todo list. New tasks start with status 'pending'.",
    snippet: "Create a new task to track a step of multi-step work",
    guidelines: [
      "Use the todo tools for complex work with 3+ steps, or when the user gives a list of tasks or new instructions to capture requirements. Skip them for single trivial tasks and purely conversational requests.",
      "Subject must be short and imperative (e.g. 'Research existing tool'); description is for long-form detail; activeForm is a present-continuous label shown while in_progress.",
    ],
    parameters: CreateTodoSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    action: "update",
    name: TODO_UPDATE,
    label: "Todo Update",
    description:
      "Update a task's fields, status, or dependencies. Status is a 4-state machine: pending -> in_progress -> completed, plus deleted as a tombstone; illegal transitions are rejected.",
    snippet: "Update a task's status, fields, or dependencies",
    guidelines: [
      "Mark a task in_progress BEFORE beginning work and completed IMMEDIATELY when done — never batch completions. Keep exactly one task in_progress at a time.",
      "Never mark a task completed if tests are failing, the implementation is partial, or you hit unresolved errors — keep it in_progress and create a task for the blocker instead.",
    ],
    parameters: UpdateTodoSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  {
    action: "list",
    name: TODO_LIST,
    label: "Todo List",
    description: "List all tasks, optionally filtered by a single status. Hides deleted (tombstoned) tasks by default.",
    snippet: "List tasks, optionally filtered by status",
    guidelines: [],
    parameters: ListTodoSchema,
    outputSchema: ListTodoOutputSchema,
    annotations: { readOnlyHint: true },
  },
  {
    action: "get",
    name: TODO_GET,
    label: "Todo Get",
    description: "Get a single task's details, including its blockedBy dependencies and the reverse blocks list.",
    snippet: "Get details of a single task",
    guidelines: [],
    parameters: GetTodoSchema,
    outputSchema: GetTodoOutputSchema,
    annotations: { readOnlyHint: true },
  },
  {
    action: "delete",
    name: TODO_DELETE,
    label: "Todo Delete",
    description: "Soft-delete a task (status -> deleted). The tombstone is kept so dependency validation still works.",
    snippet: "Soft-delete a task",
    guidelines: [],
    parameters: DeleteTodoSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  {
    action: "clear",
    name: TODO_CLEAR,
    label: "Todo Clear",
    description: "Clear all tasks and reset the task list (nextId returns to 1).",
    snippet: "Clear all tasks and reset the list",
    guidelines: [],
    parameters: ClearTodoSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
];

export function registerTodoTools(pi: ExtensionAPI): void {
  const guidance = loadConfig().guidance;
  for (const spec of TODO_TOOL_SPECS) {
    pi.registerTool({
      name: spec.name,
      label: spec.label,
      description: spec.description,
      promptSnippet: guidance?.promptSnippet ?? spec.snippet,
      promptGuidelines: guidance?.promptGuidelines ?? spec.guidelines,
      parameters: spec.parameters,
      ...(spec.outputSchema ? { outputSchema: spec.outputSchema } : {}),
      annotations: spec.annotations,
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const result = applyTaskMutation(getState(), spec.action, params as TaskMutationParams);
        commitState(result.state);
        return buildToolResult(spec.action, params as TaskMutationParams, result.state, result.op);
      },
    });
  }
}

export function registerTodosCommand(pi: ExtensionAPI): void {
  pi.registerCommand(COMMAND_NAME, {
    description: "Show all todos on the current branch, grouped by status",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify(ERR_REQUIRES_INTERACTIVE, "error");
        return;
      }
      const state = getState();
      const visible = selectVisibleTasks(state);
      if (visible.length === 0) {
        ctx.ui.notify(MSG_NO_TODOS, "info");
        return;
      }
      const groups = selectTasksByStatus(state);
      const counts = selectTodoCounts(state);

      const header: string[] = [];
      if (counts.completed > 0) header.push(`${counts.completed}/${counts.total} completed`);
      if (counts.inProgress > 0) header.push(`${counts.inProgress} in_progress`);
      if (counts.pending > 0) header.push(`${counts.pending} pending`);

      const lines: string[] = [header.join(" · ")];
      if (groups.pending.length > 0) {
        lines.push(SECTION_PENDING);
        for (const task of groups.pending) lines.push(formatCommandTaskLine(task, statusGlyph("pending")));
      }
      if (groups.inProgress.length > 0) {
        lines.push(SECTION_IN_PROGRESS);
        for (const task of groups.inProgress) lines.push(formatCommandTaskLine(task, statusGlyph("in_progress")));
      }
      if (groups.completed.length > 0) {
        lines.push(SECTION_COMPLETED);
        for (const task of groups.completed) lines.push(formatCommandTaskLine(task, statusGlyph("completed")));
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
