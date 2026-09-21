import type * as Common from "@htwang-contrib/common";
import { describe, expect, test, vi } from "vitest";
import { classifyMessageComplexity } from "../src/complexity.ts";

const mockSystemOne = vi.hoisted(() => vi.fn());

vi.mock("@htwang-contrib/common", async (importOriginal) => ({
  ...(await importOriginal<typeof Common>()),
  systemOne: mockSystemOne,
}));

describe("message complexity", () => {
  test("asks for all three model tiers in one choice question and preserves their probabilities", async () => {
    const probabilities = { flash: 0.1, middle: 0.7, flagship: 0.2 };
    mockSystemOne.mockResolvedValueOnce({ answers: { model: { probabilities } } });
    const signal = new AbortController().signal;
    expect(await classifyMessageComplexity("Fix the race condition", signal)).toEqual(probabilities);
    expect(mockSystemOne).toHaveBeenLastCalledWith(
      {
        state: { message: "Fix the race condition" },
        questions: {
          model: expect.objectContaining({
            type: "choice",
            criteria: {
              flash: expect.any(String),
              middle: expect.any(String),
              flagship: expect.any(String),
            },
          }),
        },
      },
      { signal },
    );
  });

  test("rejects an invalid probability before it reaches the renderer", async () => {
    mockSystemOne.mockResolvedValueOnce({ answers: { model: { probabilities: { flash: 0.1, middle: 0.7 } } } });
    await expect(classifyMessageComplexity("test", new AbortController().signal)).rejects.toThrow("flagship");
  });
});
