import type { Task, TaskAction, TaskMutationParams, TaskStatus } from "../tool/types.ts";
import { isTransitionValid } from "./invariants.ts";
import type { TaskState } from "./state.ts";
import { detectCycle } from "./task-graph.ts";

export type Op =
  | { kind: "create"; taskId: number }
  | { kind: "update"; id: number; fromStatus: TaskStatus; toStatus: TaskStatus }
  | { kind: "delete"; id: number; subject: string }
  | { kind: "list"; statusFilter?: TaskStatus; includeDeleted: boolean }
  | { kind: "get"; task: Task }
  | { kind: "clear"; count: number }
  | { kind: "error"; message: string };

export interface ApplyResult {
  state: TaskState;
  op: Op;
}

function errorResult(state: TaskState, message: string): ApplyResult {
  return { state, op: { kind: "error", message } };
}

type UpdateTarget = { idx: number; current: Task };
type BlockedByResult = { blockedBy: number[]; error?: undefined } | { blockedBy?: undefined; error: string };

const MUTABLE_FIELDS = ["subject", "description", "activeForm", "status", "owner", "metadata"] as const;
const TEXT_FIELDS = ["subject", "description", "activeForm", "owner"] as const;

export function applyTaskMutation(state: TaskState, action: TaskAction, params: TaskMutationParams): ApplyResult {
  switch (action) {
    case "create":
      return applyCreate(state, params);
    case "update":
      return applyUpdate(state, params);
    case "list":
      return applyList(state, params);
    case "get":
      return applyGet(state, params);
    case "delete":
      return applyDelete(state, params);
    case "clear":
      return applyClear(state);
  }
}

function depError(state: TaskState, dep: number, prefix: string): string | undefined {
  const depTask = state.tasks.find((t) => t.id === dep);
  if (!depTask) return `${prefix}: #${dep} not found`;
  if (depTask.status === "deleted") return `${prefix}: #${dep} is deleted`;
}

function firstDepError(state: TaskState, deps: number[], prefix: string): string | undefined {
  for (const dep of deps) {
    const message = depError(state, dep, prefix);
    if (message !== undefined) return message;
  }
}

function createDepsError(state: TaskState, deps: number[] | undefined): string | undefined {
  if (!deps?.length) return undefined;
  return firstDepError(state, deps, "blockedBy");
}

function copyTextFields(task: Task, params: TaskMutationParams): void {
  if (params.description) task.description = params.description;
  if (params.activeForm) task.activeForm = params.activeForm;
}

function copyOwnerFields(task: Task, params: TaskMutationParams): void {
  if (params.owner) task.owner = params.owner;
  if (params.metadata) task.metadata = { ...params.metadata };
}

function buildNewTask(state: TaskState, subject: string, params: TaskMutationParams): Task {
  const newTask: Task = { id: state.nextId, subject, status: "pending" };
  copyTextFields(newTask, params);
  if (params.blockedBy?.length) newTask.blockedBy = [...params.blockedBy];
  copyOwnerFields(newTask, params);
  return newTask;
}

function applyCreate(state: TaskState, params: TaskMutationParams): ApplyResult {
  if (!params.subject?.trim()) return errorResult(state, "subject required for create");
  const message = createDepsError(state, params.blockedBy);
  if (message !== undefined) return errorResult(state, message);
  const newTask = buildNewTask(state, params.subject, params);
  return {
    state: { tasks: [...state.tasks, newTask], nextId: state.nextId + 1 },
    op: { kind: "create", taskId: newTask.id },
  };
}

function locateForUpdate(state: TaskState, params: TaskMutationParams): UpdateTarget | string {
  if (params.id === undefined) return "id required for update";
  const idx = state.tasks.findIndex((t) => t.id === params.id);
  if (idx === -1) return `#${params.id} not found`;
  return { idx, current: state.tasks[idx] };
}

function hasDepMutation(params: TaskMutationParams): boolean {
  return Boolean(params.addBlockedBy?.length) || Boolean(params.removeBlockedBy?.length);
}

function hasMutableUpdate(params: TaskMutationParams): boolean {
  for (const field of MUTABLE_FIELDS) {
    if (params[field] !== undefined) return true;
  }
  return hasDepMutation(params);
}

function effectiveUpdateParams(params: TaskMutationParams): TaskMutationParams {
  if (hasMutableUpdate(params)) return params;
  return { ...params, status: "in_progress" };
}

function transitionErrorMessage(current: Task, effective: TaskMutationParams): string | undefined {
  const target = effective.status;
  if (target === undefined) return undefined;
  if (!isTransitionValid(current.status, target)) {
    return `illegal transition ${current.status} → ${target}`;
  }
}

function withoutDeps(deps: number[], remove: number[] | undefined): number[] {
  if (!remove?.length) return deps;
  const toRemove = new Set(remove);
  return deps.filter((dep) => !toRemove.has(dep));
}

function addedDepsError(state: TaskState, current: Task, add: number[]): string | undefined {
  for (const dep of add) {
    if (dep === current.id) return `cannot block #${current.id} on itself`;
    const message = depError(state, dep, "addBlockedBy");
    if (message !== undefined) return message;
  }
}

function mergeDeps(deps: number[], add: number[]): number[] {
  for (const dep of add) {
    if (!deps.includes(dep)) deps.push(dep);
  }
  return deps;
}

function withAddedDeps(state: TaskState, current: Task, deps: number[], add: number[]): BlockedByResult {
  const message = addedDepsError(state, current, add);
  if (message !== undefined) return { error: message };
  const merged = mergeDeps(deps, add);
  if (detectCycle(state.tasks, current.id, merged)) {
    return { error: "addBlockedBy would create a cycle in the blockedBy graph" };
  }
  return { blockedBy: merged };
}

function nextBlockedBy(state: TaskState, current: Task, effective: TaskMutationParams): BlockedByResult {
  const base = current.blockedBy ? [...current.blockedBy] : [];
  const deps = withoutDeps(base, effective.removeBlockedBy);
  const add = effective.addBlockedBy;
  if (!add?.length) return { blockedBy: deps };
  return withAddedDeps(state, current, deps, add);
}

function applyMetadataPatch(merged: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
}

function nextMetadata(current: Task, effective: TaskMutationParams): Record<string, unknown> | undefined {
  if (effective.metadata === undefined) return current.metadata;
  const merged: Record<string, unknown> = { ...(current.metadata ?? {}) };
  applyMetadataPatch(merged, effective.metadata);
  return Object.keys(merged).length ? merged : undefined;
}

function applyDefinedFields(updated: Task, effective: TaskMutationParams): void {
  for (const field of TEXT_FIELDS) {
    const value = effective[field];
    if (value !== undefined) updated[field] = value;
  }
}

function applyDepsAndMetadata(
  updated: Task,
  newBlockedBy: number[],
  newMetadata: Record<string, unknown> | undefined,
): void {
  if (newBlockedBy.length) updated.blockedBy = newBlockedBy;
  else delete updated.blockedBy;
  if (newMetadata === undefined) delete updated.metadata;
  else updated.metadata = newMetadata;
}

function buildUpdatedTask(current: Task, effective: TaskMutationParams, newBlockedBy: number[]): Task {
  const newStatus = effective.status ?? current.status;
  const updated: Task = { ...current, status: newStatus };
  applyDefinedFields(updated, effective);
  applyDepsAndMetadata(updated, newBlockedBy, nextMetadata(current, effective));
  return updated;
}

function applyUpdate(state: TaskState, params: TaskMutationParams): ApplyResult {
  const target = locateForUpdate(state, params);
  if (typeof target === "string") return errorResult(state, target);
  const { idx, current } = target;
  const effective = effectiveUpdateParams(params);
  const statusMessage = transitionErrorMessage(current, effective);
  if (statusMessage !== undefined) return errorResult(state, statusMessage);
  const deps = nextBlockedBy(state, current, effective);
  if (deps.error !== undefined) return errorResult(state, deps.error);
  const updated = buildUpdatedTask(current, effective, deps.blockedBy);
  const newTasks = [...state.tasks];
  newTasks[idx] = updated;
  return {
    state: { tasks: newTasks, nextId: state.nextId },
    op: {
      kind: "update",
      id: updated.id,
      fromStatus: current.status,
      toStatus: updated.status,
    },
  };
}

function applyList(state: TaskState, params: TaskMutationParams): ApplyResult {
  return {
    state,
    op: {
      kind: "list",
      includeDeleted: params.includeDeleted === true,
      ...(params.status !== undefined ? { statusFilter: params.status } : {}),
    },
  };
}

function applyGet(state: TaskState, params: TaskMutationParams): ApplyResult {
  if (params.id === undefined) return errorResult(state, "id required for get");
  const task = state.tasks.find((t) => t.id === params.id);
  if (!task) return errorResult(state, `#${params.id} not found`);
  return { state, op: { kind: "get", task } };
}

function applyDelete(state: TaskState, params: TaskMutationParams): ApplyResult {
  if (params.id === undefined) return errorResult(state, "id required for delete");
  const idx = state.tasks.findIndex((t) => t.id === params.id);
  if (idx === -1) return errorResult(state, `#${params.id} not found`);
  const current = state.tasks[idx];
  if (current.status === "deleted") return errorResult(state, `#${current.id} is already deleted`);
  const updated: Task = { ...current, status: "deleted" };
  const newTasks = [...state.tasks];
  newTasks[idx] = updated;
  return {
    state: { tasks: newTasks, nextId: state.nextId },
    op: { kind: "delete", id: updated.id, subject: updated.subject },
  };
}

function applyClear(state: TaskState): ApplyResult {
  const count = state.tasks.length;
  return {
    state: { tasks: [], nextId: 1 },
    op: { kind: "clear", count },
  };
}
