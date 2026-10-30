import { describe, expect, it } from "vitest";
import { buildBudgetLimitedPrompt, buildContinuationPrompt } from "../src/goal/prompt.ts";
import type { Goal } from "../src/goal/types.ts";

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "g-123",
    threadId: "t1",
    objective: "ship the feature",
    status: "active",
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastStartedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("continuation prompt marker", () => {
  it("wraps the continuation prompt in a goal-id marker", () => {
    const prompt = buildContinuationPrompt(makeGoal());
    expect(prompt.startsWith('<pi_goal_continuation goal_id="g-123">')).toBe(true);
    expect(prompt.trim().endsWith("</pi_goal_continuation>")).toBe(true);
  });

  it("wraps the budget-limited prompt in the same marker", () => {
    const prompt = buildBudgetLimitedPrompt(makeGoal({ status: "budgetLimited", tokenBudget: 1000, tokensUsed: 1200 }));
    expect(prompt.startsWith('<pi_goal_continuation goal_id="g-123">')).toBe(true);
    expect(prompt.trim().endsWith("</pi_goal_continuation>")).toBe(true);
  });

  it("escapes the objective inside untrusted_objective", () => {
    const prompt = buildContinuationPrompt(makeGoal({ objective: '<inject> & "stuff"' }));
    expect(prompt).toContain("<untrusted_objective>");
    expect(prompt).toContain("&lt;inject&gt; &amp; &quot;stuff&quot;");
    expect(prompt).not.toContain("<inject>");
  });

  it("mentions the independent verification agent", () => {
    const prompt = buildContinuationPrompt(makeGoal());
    expect(prompt).toContain("independent verification agent");
  });

  it("instructs the agent to run autonomously without ask_user_question", () => {
    const prompt = buildContinuationPrompt(makeGoal());
    expect(prompt).toContain("running autonomously");
    expect(prompt).toContain("Do not call ask_user_question");
    expect(prompt).toContain("do not wait for human input");
    expect(prompt).toContain("reasonable default");
  });

  it("instructs the budget-limited prompt not to call ask_user_question", () => {
    const prompt = buildBudgetLimitedPrompt(makeGoal({ status: "budgetLimited", tokenBudget: 1000, tokensUsed: 1200 }));
    expect(prompt).toContain("running autonomously");
    expect(prompt).toContain("Do not call ask_user_question");
    expect(prompt).toContain("do not wait for human input");
  });
});
