import { describe, expect, it } from "vitest";
import { isTransitionValid } from "../src/state/invariants.ts";
import type { TaskState } from "../src/state/state.ts";
import { applyTaskMutation } from "../src/state/state-reducer.ts";
import type { Task } from "../src/tool/types.ts";

const emptyState = (): TaskState => ({ tasks: [], nextId: 1 });

const stateWith = (...tasks: Task[]): TaskState => ({
  tasks: [...tasks],
  nextId: Math.max(0, ...tasks.map((t) => t.id)) + 1,
});

const task = (overrides: Partial<Task> & { id: number; subject: string }): Task => ({
  status: "pending",
  ...overrides,
});

describe("applyTaskMutation — create", () => {
  it("rejects empty subject", () => {
    const result = applyTaskMutation(emptyState(), "create", { subject: "" });
    expect(result.op).toEqual({
      kind: "error",
      message: "subject required for create",
    });
    expect(result.state.tasks).toHaveLength(0);
    expect(result.state.nextId).toBe(1);
  });

  it("rejects dangling blockedBy", () => {
    const result = applyTaskMutation(emptyState(), "create", {
      subject: "x",
      blockedBy: [99],
    });
    expect(result.op).toEqual({
      kind: "error",
      message: "blockedBy: #99 not found",
    });
    expect(result.state.nextId).toBe(1);
  });

  it("rejects deleted blockedBy", () => {
    const state = stateWith(task({ id: 1, subject: "done", status: "deleted" }));
    const result = applyTaskMutation(state, "create", {
      subject: "new",
      blockedBy: [1],
    });
    expect(result.op).toEqual({
      kind: "error",
      message: "blockedBy: #1 is deleted",
    });
  });

  it("creates with next id and preserves immutability", () => {
    const state = emptyState();
    const result = applyTaskMutation(state, "create", {
      subject: "write tests",
    });
    expect(result.state.tasks).toHaveLength(1);
    expect(result.state.tasks[0]).toMatchObject({
      id: 1,
      subject: "write tests",
      status: "pending",
    });
    expect(result.state.nextId).toBe(2);
    expect(result.state.tasks).not.toBe(state.tasks);
    expect(result.op).toEqual({ kind: "create", taskId: 1 });
  });
});

describe("applyTaskMutation — update", () => {
  describe("bare update (no mutable field) defaults to in_progress", () => {
    it("marks a pending task in_progress", () => {
      const state = stateWith(task({ id: 1, subject: "x" }));
      const result = applyTaskMutation(state, "update", { id: 1 });
      expect(result.op).toEqual({
        kind: "update",
        id: 1,
        fromStatus: "pending",
        toStatus: "in_progress",
      });
      expect(result.state.tasks[0].status).toBe("in_progress");
    });

    it("ignores list-only includeDeleted:false noise (session repro)", () => {
      const state = stateWith(task({ id: 1, subject: "x" }));
      const result = applyTaskMutation(state, "update", { id: 1, includeDeleted: false });
      expect(result.op).toEqual({
        kind: "update",
        id: 1,
        fromStatus: "pending",
        toStatus: "in_progress",
      });
      expect(result.state.tasks[0].status).toBe("in_progress");
    });

    it("is idempotent when already in_progress", () => {
      const state = stateWith(task({ id: 1, subject: "x", status: "in_progress" }));
      const result = applyTaskMutation(state, "update", { id: 1 });
      expect(result.op).toEqual({
        kind: "update",
        id: 1,
        fromStatus: "in_progress",
        toStatus: "in_progress",
      });
      expect(result.state.tasks[0].status).toBe("in_progress");
    });

    it("rejects illegal transition when completed", () => {
      const state = stateWith(task({ id: 1, subject: "x", status: "completed" }));
      const result = applyTaskMutation(state, "update", { id: 1 });
      expect(result.op).toEqual({
        kind: "error",
        message: "illegal transition completed → in_progress",
      });
    });

    it("rejects illegal transition when deleted", () => {
      const state = stateWith(task({ id: 1, subject: "x", status: "deleted" }));
      const result = applyTaskMutation(state, "update", { id: 1 });
      expect(result.op).toEqual({
        kind: "error",
        message: "illegal transition deleted → in_progress",
      });
    });

    it("still fails on missing id", () => {
      const state = stateWith(task({ id: 1, subject: "x" }));
      const result = applyTaskMutation(state, "update", {});
      expect(result.op).toEqual({
        kind: "error",
        message: "id required for update",
      });
    });

    it("still fails on unknown id", () => {
      const state = stateWith(task({ id: 1, subject: "x" }));
      const result = applyTaskMutation(state, "update", { id: 999 });
      expect(result.op).toEqual({
        kind: "error",
        message: "#999 not found",
      });
    });

    it("does not force in_progress when only a non-status field is mutated", () => {
      const state = stateWith(task({ id: 1, subject: "x", status: "pending" }));
      const result = applyTaskMutation(state, "update", { id: 1, subject: "renamed" });
      expect(result.op).toEqual({
        kind: "update",
        id: 1,
        fromStatus: "pending",
        toStatus: "pending",
      });
      expect(result.state.tasks[0].subject).toBe("renamed");
      expect(result.state.tasks[0].status).toBe("pending");
    });
  });

  it("rejects illegal transition completed → in_progress", () => {
    const state = stateWith(task({ id: 1, subject: "x", status: "completed" }));
    const result = applyTaskMutation(state, "update", {
      id: 1,
      status: "in_progress",
    });
    expect(result.op).toEqual({
      kind: "error",
      message: "illegal transition completed → in_progress",
    });
  });

  it("allows completed → deleted transition", () => {
    const state = stateWith(task({ id: 1, subject: "x", status: "completed" }));
    const result = applyTaskMutation(state, "update", {
      id: 1,
      status: "deleted",
    });
    expect(result.op).toEqual({
      kind: "update",
      id: 1,
      fromStatus: "completed",
      toStatus: "deleted",
    });
    expect(result.state.tasks[0].status).toBe("deleted");
  });

  it("rejects self-block via addBlockedBy", () => {
    const state = stateWith(task({ id: 1, subject: "x" }));
    const result = applyTaskMutation(state, "update", {
      id: 1,
      addBlockedBy: [1],
    });
    expect(result.op).toEqual({
      kind: "error",
      message: "cannot block #1 on itself",
    });
  });

  it("rejects cycle in blockedBy graph", () => {
    const state = stateWith(task({ id: 1, subject: "a", blockedBy: [2] }), task({ id: 2, subject: "b" }));
    const result = applyTaskMutation(state, "update", {
      id: 2,
      addBlockedBy: [1],
    });
    expect(result.op).toEqual({
      kind: "error",
      message: "addBlockedBy would create a cycle in the blockedBy graph",
    });
  });

  it("drops blockedBy field when merged set becomes empty", () => {
    const state = stateWith(task({ id: 1, subject: "a", blockedBy: [2] }), task({ id: 2, subject: "b" }));
    const result = applyTaskMutation(state, "update", {
      id: 1,
      removeBlockedBy: [2],
    });
    const updated = result.state.tasks[0];
    expect("blockedBy" in updated).toBe(false);
  });

  it("drops metadata key when value is null", () => {
    const state = stateWith(task({ id: 1, subject: "x", metadata: { a: 1, b: 2 } }));
    const result = applyTaskMutation(state, "update", {
      id: 1,
      metadata: { a: null },
    });
    expect(result.state.tasks[0].metadata).toEqual({ b: 2 });
  });

  it("sets and overwrites metadata keys when value is non-null", () => {
    const state = stateWith(task({ id: 1, subject: "x", metadata: { a: 1, b: 2 } }));
    const result = applyTaskMutation(state, "update", {
      id: 1,
      metadata: { a: 99, c: 3 },
    });
    expect(result.state.tasks[0].metadata).toEqual({ a: 99, b: 2, c: 3 });
  });

  it("collapses metadata to undefined when every key is deleted", () => {
    const state = stateWith(task({ id: 1, subject: "x", metadata: { a: 1 } }));
    const result = applyTaskMutation(state, "update", {
      id: 1,
      metadata: { a: null },
    });
    expect("metadata" in result.state.tasks[0]).toBe(false);
  });
});

describe("applyTaskMutation — list/get/delete/clear", () => {
  it("list emits Op with includeDeleted flag and optional statusFilter", () => {
    const state = stateWith(
      task({ id: 1, subject: "a", status: "pending" }),
      task({ id: 2, subject: "b", status: "deleted" }),
    );
    const result = applyTaskMutation(state, "list", {
      includeDeleted: true,
      status: "deleted",
    });
    expect(result.op).toEqual({
      kind: "list",
      includeDeleted: true,
      statusFilter: "deleted",
    });
    expect(result.state).toBe(state);
  });

  it("delete on already-deleted task errors", () => {
    const state = stateWith(task({ id: 1, subject: "x", status: "deleted" }));
    const result = applyTaskMutation(state, "delete", { id: 1 });
    expect(result.op).toEqual({
      kind: "error",
      message: "#1 is already deleted",
    });
  });

  it("delete emits Op with id + subject", () => {
    const state = stateWith(task({ id: 1, subject: "x" }));
    const result = applyTaskMutation(state, "delete", { id: 1 });
    expect(result.op).toEqual({ kind: "delete", id: 1, subject: "x" });
    expect(result.state.tasks[0].status).toBe("deleted");
  });

  it("clear emits Op with prior count and resets nextId to 1", () => {
    const state = stateWith(task({ id: 5, subject: "x" }));
    const result = applyTaskMutation(state, "clear", {});
    expect(result.op).toEqual({ kind: "clear", count: 1 });
    expect(result.state.tasks).toHaveLength(0);
    expect(result.state.nextId).toBe(1);
  });

  it("get emits Op with the resolved task", () => {
    const state = stateWith(task({ id: 1, subject: "alpha" }));
    const result = applyTaskMutation(state, "get", { id: 1 });
    expect(result.op).toEqual({ kind: "get", task: state.tasks[0] });
  });
});

describe("isTransitionValid", () => {
  it("is idempotent on same→same", () => {
    expect(isTransitionValid("completed", "completed")).toBe(true);
  });

  it("rejects completed → in_progress", () => {
    expect(isTransitionValid("completed", "in_progress")).toBe(false);
  });

  it("allows completed → deleted", () => {
    expect(isTransitionValid("completed", "deleted")).toBe(true);
  });
});
