import { describe, expect, it } from "vitest";
import { createRecoveryState, noteRecoveryError, resetRecovery } from "../src/goal/recovery.ts";

describe("goal recovery state", () => {
  it("starts with zero errors and no message", () => {
    const state = createRecoveryState();
    expect(state.consecutiveErrors).toBe(0);
    expect(state.lastErrorMessage).toBeNull();
  });

  it("counts consecutive errors and stores the last message", () => {
    const state = createRecoveryState();
    noteRecoveryError(state, "boom");
    noteRecoveryError(state, "boom2");
    expect(state.consecutiveErrors).toBe(2);
    expect(state.lastErrorMessage).toBe("boom2");
  });

  it("resets back to a clean slate", () => {
    const state = createRecoveryState();
    noteRecoveryError(state, "boom");
    resetRecovery(state);
    expect(state.consecutiveErrors).toBe(0);
    expect(state.lastErrorMessage).toBeNull();
  });
});
