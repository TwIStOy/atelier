import { describe, expect, it } from "vitest";
import {
  createReminderCadence,
  drainReminderForContext,
  evaluateToolResult,
  onTurnStart,
  resetReminderCadence,
} from "../src/reminder/cadence.ts";
import { buildReminderMessage } from "../src/reminder/message.ts";
import type { Task } from "../src/tool/types.ts";

const task = (overrides: Partial<Task> & { id: number; subject: string }): Task => ({
  status: "pending",
  ...overrides,
});

function runTurns(state: ReturnType<typeof createReminderCadence>, n: number, hasTasks = true): void {
  for (let i = 0; i < n; i++) {
    onTurnStart(state);
    evaluateToolResult(state, false, hasTasks, 4);
  }
}

describe("reminder cadence", () => {
  it("marks the reminder due after interval turns without todo tool usage", () => {
    const state = createReminderCadence();
    runTurns(state, 3);
    expect(state.reminderDue).toBe(false);
    runTurns(state, 1);
    expect(state.reminderDue).toBe(true);
  });

  it("does not mark due when the task list is empty", () => {
    const state = createReminderCadence();
    runTurns(state, 10, false);
    expect(state.reminderDue).toBe(false);
  });

  it("todo tool usage resets the cadence", () => {
    const state = createReminderCadence();
    runTurns(state, 3);
    evaluateToolResult(state, true, false, 4);
    expect(state.reminderDue).toBe(false);
    runTurns(state, 3);
    expect(state.reminderDue).toBe(false);
    runTurns(state, 1);
    expect(state.reminderDue).toBe(true);
  });

  it("drain injects once, then re-arms the interval", () => {
    const state = createReminderCadence();
    runTurns(state, 4);
    expect(drainReminderForContext(state)).toBe(true);
    expect(drainReminderForContext(state)).toBe(false);

    runTurns(state, 3);
    expect(state.reminderDue).toBe(false);
    runTurns(state, 1);
    expect(state.reminderDue).toBe(true);
  });

  it("reminds again after another interval of todo tool silence", () => {
    const state = createReminderCadence();
    runTurns(state, 4);
    drainReminderForContext(state);
    runTurns(state, 4);
    expect(drainReminderForContext(state)).toBe(true);
  });

  it("todo tool usage clears a pending reminder before context drains it", () => {
    const state = createReminderCadence();
    runTurns(state, 4);
    expect(state.reminderDue).toBe(true);
    evaluateToolResult(state, true, false, 4);
    expect(drainReminderForContext(state)).toBe(false);
  });

  it("reset returns to a clean state", () => {
    const state = createReminderCadence();
    runTurns(state, 4);
    drainReminderForContext(state);
    resetReminderCadence(state);
    expect(state).toEqual(createReminderCadence());
  });
});

describe("buildReminderMessage", () => {
  it("wraps guidance and the current list in system-reminder tags", () => {
    const message = buildReminderMessage([
      task({ id: 1, subject: "Fix auth bug", status: "completed" }),
      task({ id: 2, subject: "Write tests", status: "in_progress", activeForm: "writing tests" }),
      task({ id: 3, subject: "Update docs", blockedBy: [2] }),
    ]);
    expect(message).toBe(
      [
        "<system-reminder>",
        "The todo tools haven't been used recently. If you're working on tasks that would benefit from tracking progress, use todo_update to keep task status current (in_progress when starting, completed when done) and todo_create for newly discovered work. Also consider cleaning up the list if it has become stale. Only do so if it's relevant to the current work. This is just a gentle reminder - ignore if not applicable.",
        "",
        "Current todo list:",
        "[completed] #1 Fix auth bug",
        "[in_progress] #2 Write tests (writing tests)",
        "[pending] #3 Update docs ⛓ #2",
        "",
        "Make sure that you NEVER mention this reminder to the user.",
        "</system-reminder>",
      ].join("\n"),
    );
  });
});
