import type { JsonValue } from "@earendil-works/pi-ai";
import type { TaskState } from "../state/state.ts";
import type { Op } from "../state/state-reducer.ts";
import { deriveBlocks } from "../state/task-graph.ts";
import { formatTaskListLine } from "../view/format.ts";
import type { Task, TaskAction, TaskDetails, TaskMutationParams, TaskStatus } from "./types.ts";

type StructuredTask = {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string;
  status: TaskStatus;
  blockedBy?: number[];
  owner?: string;
  metadata?: Record<string, JsonValue>;
};

type TodoListStructured = { tasks: StructuredTask[]; nextId: number };
type TodoGetStructured = { task: StructuredTask; blocks: number[] };

function formatGetLines(task: Task, state: TaskState): string {
  const blocks = deriveBlocks(state.tasks).get(task.id) ?? [];
  const lines = [`#${task.id} [${task.status}] ${task.subject}`];
  if (task.description) lines.push(`  description: ${task.description}`);
  if (task.activeForm) lines.push(`  activeForm: ${task.activeForm}`);
  if (task.blockedBy?.length) {
    lines.push(`  blockedBy: ${task.blockedBy.map((id) => `#${id}`).join(", ")}`);
  }
  if (blocks.length) {
    lines.push(`  blocks: ${blocks.map((id) => `#${id}`).join(", ")}`);
  }
  if (task.owner) lines.push(`  owner: ${task.owner}`);
  return lines.join("\n");
}

function listView(op: Extract<Op, { kind: "list" }>, state: TaskState): Task[] {
  let view = state.tasks;
  if (!op.includeDeleted) view = view.filter((t) => t.status !== "deleted");
  if (op.statusFilter) view = view.filter((t) => t.status === op.statusFilter);
  return view;
}

function structuredContentFor(op: Op, state: TaskState): TodoListStructured | TodoGetStructured | undefined {
  if (op.kind === "list") return { tasks: listView(op, state) as StructuredTask[], nextId: state.nextId };
  if (op.kind === "get") {
    return { task: op.task as StructuredTask, blocks: deriveBlocks(state.tasks).get(op.task.id) ?? [] };
  }
  return undefined;
}

export function formatContent(op: Op, state: TaskState): string {
  switch (op.kind) {
    case "create": {
      const t = state.tasks.find((x) => x.id === op.taskId);
      if (!t) return `Created #${op.taskId}`;
      return `Created #${t.id}: ${t.subject} (pending)`;
    }
    case "update": {
      const transition = op.fromStatus !== op.toStatus ? ` (${op.fromStatus} → ${op.toStatus})` : "";
      return `Updated #${op.id}${transition}`;
    }
    case "delete":
      return `Deleted #${op.id}: ${op.subject}`;
    case "clear":
      return `Cleared ${op.count} tasks`;
    case "list": {
      const view = listView(op, state);
      return view.length === 0 ? "No tasks" : view.map(formatTaskListLine).join("\n");
    }
    case "get":
      return formatGetLines(op.task, state);
    case "error":
      return `Error: ${op.message}`;
  }
}

export function buildToolResult(
  action: TaskAction,
  params: TaskMutationParams,
  state: TaskState,
  op: Op,
): {
  content: Array<{ type: "text"; text: string }>;
  details: TaskDetails;
  structuredContent?: TodoListStructured | TodoGetStructured;
} {
  const text = formatContent(op, state);
  const details: TaskDetails = {
    action,
    params: params as Record<string, unknown>,
    tasks: state.tasks,
    nextId: state.nextId,
    ...(op.kind === "error" ? { error: op.message } : {}),
  };
  const structuredContent = structuredContentFor(op, state);
  return {
    content: [{ type: "text", text }],
    details,
    ...(structuredContent !== undefined ? { structuredContent } : {}),
  };
}
