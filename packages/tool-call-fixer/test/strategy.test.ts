import * as assert from "node:assert/strict";
import { describe, it } from "vitest";
import { applyStrategies, DEFAULT_CONFIG, type Strategy, type ToolCallFixerConfig } from "../src/strategy.ts";

const baseConfig: ToolCallFixerConfig = { ...DEFAULT_CONFIG };

const swapStrategy: Strategy = {
  id: "swap-bad-for-good",
  description: "Replaces a bad flag with a good one (fixture).",
  apply: (_toolName, input) => {
    if (input.bad === true) {
      delete input.bad;
      input.good = true;
      return { applied: true, note: "swapped bad for good" };
    }
    return { applied: false };
  },
};

describe("applyStrategies", () => {
  it("does nothing when disabled", () => {
    const input: Record<string, unknown> = { bad: true };
    const outcome = applyStrategies("bash", input, { ...baseConfig, enabled: false }, [swapStrategy]);
    assert.equal(outcome.applied, false);
    assert.deepEqual(input, { bad: true });
  });

  it("reports no change when no strategy matches", () => {
    const input: Record<string, unknown> = { command: "ls" };
    const outcome = applyStrategies("bash", input, baseConfig, [swapStrategy]);
    assert.equal(outcome.applied, false);
    assert.deepEqual(outcome.notes, []);
    assert.deepEqual(input, { command: "ls" });
  });

  it("mutates input in place and records a note when a strategy matches", () => {
    const input: Record<string, unknown> = { bad: true };
    const outcome = applyStrategies("bash", input, baseConfig, [swapStrategy]);
    assert.equal(outcome.applied, true);
    assert.deepEqual(outcome.notes, ["swap-bad-for-good: swapped bad for good"]);
    assert.deepEqual(input, { good: true });
  });

  it("runs strategies in registration order and keeps object identity", () => {
    const input: Record<string, unknown> = { bad: true };
    const original = input;
    const outcome = applyStrategies("bash", input, baseConfig, [swapStrategy]);
    assert.equal(outcome.applied, true);
    assert.equal(input, original);
  });
});
