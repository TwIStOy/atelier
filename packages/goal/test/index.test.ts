import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { GOAL_UPDATE_EVENT } from "@htwang-contrib/common";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@htwang-contrib/common", async (importOriginal) => {
  const actual = await importOriginal<typeof Common>();
  return {
    ...actual,
    isExtensionDisabled: () => false,
  };
});

import type * as Common from "@htwang-contrib/common";
import { createGoal, type GoalStoreRef, updateGoal } from "../src/goal/store.ts";
import initGoal from "../src/index.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

interface EmittedEvent {
  name: string;
  payload: unknown;
}

interface MockState {
  pi: ExtensionAPI;
  handlers: Map<string, Handler[]>;
  emitted: EmittedEvent[];
}

function buildPi(): MockState {
  const handlers = new Map<string, Handler[]>();
  const emitted: EmittedEvent[] = [];
  const pi = {
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerCommand: () => {},
    registerTool: () => {},
    sendMessage: () => {},
    events: {
      emit: (name: string, payload?: unknown) => {
        emitted.push({ name, payload });
      },
      on: () => {},
    },
  };
  return { pi: pi as unknown as ExtensionAPI, handlers, emitted };
}

function sessionCtx(ref: GoalStoreRef): ExtensionContext {
  return {
    hasUI: false,
    isIdle: () => true,
    hasPendingMessages: () => false,
    sessionManager: {
      getSessionDir: () => ref.baseDir,
      getSessionId: () => ref.threadId,
    },
    modelRegistry: {
      getAvailable: () => [],
    },
  } as unknown as ExtensionContext;
}

function fireSessionStart(state: MockState, ctx: ExtensionContext): void {
  for (const handler of state.handlers.get("session_start") ?? []) {
    handler({ type: "session_start", reason: "resume" }, ctx);
  }
}

function goalUpdates(state: MockState): EmittedEvent[] {
  return state.emitted.filter((e) => e.name === GOAL_UPDATE_EVENT);
}

let tempDirs: string[] = [];

function tempStore(): GoalStoreRef {
  const baseDir = mkdtempSync(join(tmpdir(), "goal-index-test-"));
  tempDirs.push(baseDir);
  return { baseDir, threadId: "thread-1" };
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("goal session_start initial sync", () => {
  test("emits goal:update with the stored active goal", () => {
    const ref = tempStore();
    const goal = createGoal(ref, "ship the feature", null);
    const state = buildPi();
    initGoal(state.pi);

    fireSessionStart(state, sessionCtx(ref));

    const updates = goalUpdates(state);
    expect(updates).toHaveLength(1);
    const payload = updates[0].payload as { id: string; status: string; objective: string };
    expect(payload.id).toBe(goal.id);
    expect(payload.status).toBe("active");
    expect(payload.objective).toBe("ship the feature");
  });

  test("emits goal:update with a non-active goal so consumers clear goal mode", () => {
    const ref = tempStore();
    createGoal(ref, "ship the feature", null);
    updateGoal(ref, { status: "paused" });
    const state = buildPi();
    initGoal(state.pi);

    fireSessionStart(state, sessionCtx(ref));

    const updates = goalUpdates(state);
    expect(updates).toHaveLength(1);
    expect((updates[0].payload as { status: string }).status).toBe("paused");
  });

  test("emits goal:update null when no goal is stored", () => {
    const ref = tempStore();
    const state = buildPi();
    initGoal(state.pi);

    fireSessionStart(state, sessionCtx(ref));

    expect(goalUpdates(state)).toEqual([{ name: GOAL_UPDATE_EVENT, payload: null }]);
  });
});
