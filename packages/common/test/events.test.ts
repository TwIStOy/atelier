import { describe, expect, test } from "vitest";
import { GOAL_UPDATE_EVENT, type GoalUpdatePayload } from "../src/events.ts";

describe("GOAL_UPDATE_EVENT contract", () => {
  test("channel name is stable for cross-extension consumers", () => {
    expect(GOAL_UPDATE_EVENT).toBe("goal:update");
  });

  // Compile-time anchor: producers and consumers meet this payload contract
  // only at runtime through the untyped event bus, so this fixture is the one
  // place tsc checks the status literal union and the null member.
  test("payload contract accepts every status literal and null", () => {
    const payloads: GoalUpdatePayload[] = [
      { status: "active" },
      { status: "paused" },
      { status: "budgetLimited" },
      { status: "complete" },
      null,
    ];
    expect(payloads.every((p) => p === null || typeof p.status === "string")).toBe(true);
  });
});
