import type { TaskDetails } from "../tool/types.ts";
import { EMPTY_STATE, type TaskState } from "./state.ts";

export function isTaskDetails(value: unknown): value is TaskDetails {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.tasks) && typeof v.nextId === "number";
}

export function replayFromBranch(ctx: { sessionManager: { getBranch(): Iterable<unknown> } }): TaskState {
  let result: TaskState = {
    tasks: [...EMPTY_STATE.tasks],
    nextId: EMPTY_STATE.nextId,
  };
  for (const entry of ctx.sessionManager.getBranch()) {
    const e = entry as {
      type?: string;
      message?: { role?: string; toolName?: string; details?: unknown };
    };
    if (e.type !== "message") continue;
    const msg = e.message;
    if (msg?.role !== "toolResult" || msg.toolName !== "todo") continue;
    if (!isTaskDetails(msg.details)) continue;
    result = {
      tasks: msg.details.tasks.map((t) => ({ ...t })),
      nextId: msg.details.nextId,
    };
  }
  return result;
}
