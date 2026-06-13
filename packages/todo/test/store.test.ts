import { describe, expect, it } from "vitest";
import type { Task } from "../tool/types.ts";
import { EMPTY_STATE, type TaskState } from "../state/state.ts";
import {
  __resetState,
  commitState,
  getNextId,
  getState,
  getTodos,
  replaceState,
} from "../state/store.ts";

function makeTask(id: number, subject = `t${id}`): Task {
  return { id, subject, status: "pending" };
}

describe("rpiv-todo/state/store — accessors and seams", () => {
  it("__resetState() restores EMPTY_STATE shape (independent of EMPTY_STATE.tasks identity)", () => {
    __resetState();
    expect(getTodos()).toEqual(EMPTY_STATE.tasks);
    expect(getNextId()).toBe(EMPTY_STATE.nextId);
    expect(getTodos()).not.toBe(EMPTY_STATE.tasks);
  });

  it("getTodos() returns an isolated copy (mutating it does not affect the live cell)", () => {
    __resetState();
    const next: TaskState = { tasks: [makeTask(1)], nextId: 2 };
    commitState(next);
    expect(getTodos()).toEqual([makeTask(1)]);
    expect(getTodos()).not.toBe(next.tasks);
    (getTodos() as Task[]).push(makeTask(99));
    expect(getState().tasks).toEqual([makeTask(1)]);
    expect(getTodos()).toEqual([makeTask(1)]);
  });

  it("getNextId() reflects the current cell value", () => {
    __resetState();
    commitState({ tasks: [], nextId: 42 });
    expect(getNextId()).toBe(42);
  });

  it("getState() cell is read consistently by getTodos/getNextId", () => {
    __resetState();
    const next: TaskState = {
      tasks: [makeTask(7, "lucky")],
      nextId: 8,
    };
    commitState(next);
    const snap = getState();
    expect(snap).toBe(next);
    expect(snap.tasks).toEqual(getTodos());
    expect(snap.nextId).toBe(getNextId());
  });

  it("replaceState() publishes a new cell wholesale (replay seam)", () => {
    __resetState();
    const replayed: TaskState = {
      tasks: [makeTask(10, "from-branch"), makeTask(11, "from-branch-2")],
      nextId: 12,
    };
    replaceState(replayed);
    expect(getState()).toBe(replayed);
    expect(getTodos()).toEqual(replayed.tasks);
    expect(getTodos()).not.toBe(replayed.tasks);
    expect(getNextId()).toBe(12);
  });

  it("commitState() and replaceState() are interchangeable seams over the same cell", () => {
    __resetState();
    commitState({ tasks: [makeTask(1)], nextId: 2 });
    expect(getNextId()).toBe(2);
    replaceState({ tasks: [], nextId: 99 });
    expect(getTodos()).toEqual([]);
    expect(getNextId()).toBe(99);
  });

  it("__resetState() after a commit clears the cell (test-isolation contract)", () => {
    commitState({ tasks: [makeTask(1)], nextId: 2 });
    __resetState();
    expect(getTodos()).toEqual([]);
    expect(getNextId()).toBe(1);
  });
});
