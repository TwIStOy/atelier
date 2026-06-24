import { describe, expect, it } from "vitest";
import { isTaskDetails, replayFromBranch } from "../src/state/replay.ts";
import type { Task, TaskDetails } from "../src/tool/types.ts";

function buildBranch(snapshots: TaskDetails[]) {
  return snapshots.map((s) => ({
    type: "message",
    message: {
      role: "toolResult",
      toolCallId: "call-todo",
      toolName: "todo",
      content: [{ type: "text", text: "ok" }],
      details: s,
      isError: false,
      timestamp: Date.now(),
    },
  }));
}

const taskFixture = (id: number, subject: string, extra: Partial<Task> = {}): Task => ({
  id,
  subject,
  status: "pending",
  ...extra,
});

function userMessage(text: string) {
  return {
    type: "message",
    message: {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    },
  };
}

describe("isTaskDetails — defensive type guard", () => {
  it("rejects null and undefined", () => {
    expect(isTaskDetails(null)).toBe(false);
    expect(isTaskDetails(undefined)).toBe(false);
  });

  it("rejects primitives (string, number, boolean)", () => {
    expect(isTaskDetails("oops")).toBe(false);
    expect(isTaskDetails(42)).toBe(false);
    expect(isTaskDetails(true)).toBe(false);
  });

  it("rejects objects missing tasks[] or nextId", () => {
    expect(isTaskDetails({})).toBe(false);
    expect(isTaskDetails({ tasks: "x", nextId: 1 })).toBe(false);
    expect(isTaskDetails({ tasks: [], nextId: "1" })).toBe(false);
  });

  it("accepts well-formed snapshot envelopes", () => {
    expect(isTaskDetails({ tasks: [], nextId: 1 })).toBe(true);
    expect(isTaskDetails({ action: "create", params: {}, tasks: [], nextId: 1 })).toBe(true);
  });
});

describe("replayFromBranch", () => {
  it("returns empty TaskState when branch has no todo toolResults", () => {
    const ctx = {
      sessionManager: { getBranch: () => [userMessage("hi")] },
    };
    const state = replayFromBranch(ctx);
    expect(state.tasks).toEqual([]);
    expect(state.nextId).toBe(1);
  });

  it("replays the last snapshot (last-write-wins)", () => {
    const ctx = {
      sessionManager: {
        getBranch: () =>
          buildBranch([
            {
              action: "create",
              params: {},
              tasks: [taskFixture(1, "old")],
              nextId: 2,
            },
            {
              action: "create",
              params: {},
              tasks: [taskFixture(1, "old"), taskFixture(2, "new")],
              nextId: 3,
            },
          ]),
      },
    };
    const state = replayFromBranch(ctx);
    expect(state.tasks).toHaveLength(2);
    expect(state.nextId).toBe(3);
  });

  it("clones tasks so mutating the fixture does not mutate replayed state", () => {
    const fixture: Task = taskFixture(1, "original");
    const ctx = {
      sessionManager: {
        getBranch: () => buildBranch([{ action: "create", params: {}, tasks: [fixture], nextId: 2 }]),
      },
    };
    const state = replayFromBranch(ctx);
    const replayed = state.tasks[0];
    expect(replayed).not.toBe(fixture);
    expect(replayed.subject).toBe("original");
  });

  it("skips non-message entries in the branch (defensive type guard)", () => {
    const ctx = {
      sessionManager: {
        getBranch: () => [
          { type: "tool_call", call: { id: "x" } },
          ...buildBranch([
            {
              action: "create",
              params: {},
              tasks: [taskFixture(1, "kept")],
              nextId: 2,
            },
          ]),
        ],
      },
    };
    const state = replayFromBranch(ctx);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]?.subject).toBe("kept");
    expect(state.nextId).toBe(2);
  });

  it("skips toolResult entries whose details fail isTaskDetails (corrupt-snapshot guard)", () => {
    const corrupt = {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "todo",
        details: { tasks: "not-an-array" },
      },
    };
    const ctx = {
      sessionManager: {
        getBranch: () => [
          ...buildBranch([
            {
              action: "create",
              params: {},
              tasks: [taskFixture(1, "good")],
              nextId: 2,
            },
          ]),
          corrupt,
        ],
      },
    };
    const state = replayFromBranch(ctx);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]?.subject).toBe("good");
  });

  it("returns a fresh empty TaskState when called with an empty branch", () => {
    const ctx1 = {
      sessionManager: {
        getBranch: () =>
          buildBranch([
            {
              action: "create",
              params: {},
              tasks: [taskFixture(1, "x")],
              nextId: 2,
            },
          ]),
      },
    };
    expect(replayFromBranch(ctx1).nextId).toBe(2);

    const ctx2 = {
      sessionManager: { getBranch: () => [userMessage("hi")] },
    };
    const fresh = replayFromBranch(ctx2);
    expect(fresh.tasks).toEqual([]);
    expect(fresh.nextId).toBe(1);
  });

  it("skips non-todo toolResults", () => {
    const ctx = {
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "other",
              details: { tasks: [taskFixture(1, "other")], nextId: 2 },
            },
          },
          ...buildBranch([
            {
              action: "create",
              params: {},
              tasks: [taskFixture(1, "todo")],
              nextId: 2,
            },
          ]),
        ],
      },
    };
    const state = replayFromBranch(ctx);
    expect(state.tasks[0]?.subject).toBe("todo");
  });
});
