import { Type } from "@sinclair/typebox";

export const COMMAND_NAME = "todos";

export const ERR_REQUIRES_INTERACTIVE = "/todos requires interactive mode";
export const MSG_NO_TODOS = "No todos yet. Ask the agent to add some!";

export const TODO_CREATE = "todo_create";
export const TODO_UPDATE = "todo_update";
export const TODO_LIST = "todo_list";
export const TODO_GET = "todo_get";
export const TODO_DELETE = "todo_delete";
export const TODO_CLEAR = "todo_clear";

export const TODO_TOOL_NAMES = [TODO_CREATE, TODO_UPDATE, TODO_LIST, TODO_GET, TODO_DELETE, TODO_CLEAR] as const;

const LEGACY_TODO_TOOL_NAME = "todo";

export function isTodoToolName(name: string | undefined): boolean {
  if (!name) return false;
  return name === LEGACY_TODO_TOOL_NAME || (TODO_TOOL_NAMES as readonly string[]).includes(name);
}

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export type TaskAction = "create" | "update" | "list" | "get" | "delete" | "clear";

export interface Task {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string;
  status: TaskStatus;
  blockedBy?: number[];
  owner?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskDetails {
  action: TaskAction;
  params: Record<string, unknown>;
  tasks: Task[];
  nextId: number;
  error?: string;
}

export interface TaskMutationParams {
  [key: string]: unknown;
  subject?: string;
  description?: string;
  activeForm?: string;
  status?: TaskStatus;
  blockedBy?: number[];
  addBlockedBy?: number[];
  removeBlockedBy?: number[];
  owner?: string;
  metadata?: Record<string, unknown>;
  id?: number;
  includeDeleted?: boolean;
}

const taskStatusLiterals = [
  Type.Literal("pending"),
  Type.Literal("in_progress"),
  Type.Literal("completed"),
  Type.Literal("deleted"),
];

const taskDescription = Type.Optional(Type.String({ description: "Long-form task description" }));
const taskActiveForm = Type.Optional(
  Type.String({
    description: "Present-continuous spinner label shown while status is in_progress (e.g. 'writing tests')",
  }),
);
const taskOwner = Type.Optional(Type.String({ description: "Agent/owner assigned to this task" }));

export const CreateTodoSchema = Type.Object({
  subject: Type.String({ description: "Task subject line (short and imperative)" }),
  description: taskDescription,
  activeForm: taskActiveForm,
  blockedBy: Type.Optional(Type.Array(Type.Number(), { description: "Initial blockedBy task ids" })),
  owner: taskOwner,
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Arbitrary metadata" })),
});

export const UpdateTodoSchema = Type.Object({
  id: Type.Number({ description: "Task id to update" }),
  subject: Type.Optional(Type.String({ description: "New task subject line" })),
  description: taskDescription,
  activeForm: taskActiveForm,
  status: Type.Optional(
    Type.Union(taskStatusLiterals, {
      description:
        "Target status. Sending it explicitly is preferred; an update with only an id (no other field) defaults to in_progress",
    }),
  ),
  addBlockedBy: Type.Optional(
    Type.Array(Type.Number(), {
      description: "Task ids to add to blockedBy (additive merge; self-blocks and cycles are rejected)",
    }),
  ),
  removeBlockedBy: Type.Optional(
    Type.Array(Type.Number(), { description: "Task ids to remove from blockedBy (additive merge)" }),
  ),
  owner: taskOwner,
  metadata: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: "Arbitrary metadata; pass a null value for a key to delete that key",
    }),
  ),
});

export const ListTodoSchema = Type.Object({
  status: Type.Optional(Type.Union(taskStatusLiterals, { description: "Filter tasks to a single status" })),
  includeDeleted: Type.Optional(
    Type.Boolean({
      description: "If true, include deleted (tombstoned) tasks. Default: false",
    }),
  ),
});

export const GetTodoSchema = Type.Object({
  id: Type.Number({ description: "Task id to fetch" }),
});

export const DeleteTodoSchema = Type.Object({
  id: Type.Number({ description: "Task id to soft-delete" }),
});

export const ClearTodoSchema = Type.Object({});

const TaskSchema = Type.Object({
  id: Type.Number(),
  subject: Type.String(),
  description: Type.Optional(Type.String()),
  activeForm: Type.Optional(Type.String()),
  status: Type.Union(taskStatusLiterals),
  blockedBy: Type.Optional(Type.Array(Type.Number())),
  owner: Type.Optional(Type.String()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const ListTodoOutputSchema = Type.Object({
  tasks: Type.Array(TaskSchema),
  nextId: Type.Number(),
});

export const GetTodoOutputSchema = Type.Object({
  task: TaskSchema,
  blocks: Type.Array(Type.Number()),
});
