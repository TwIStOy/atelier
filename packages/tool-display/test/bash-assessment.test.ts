import type * as Common from "@htwang-contrib/common";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { assessBashCommand } from "../src/bash-assessment.ts";

const mockSystemOne = vi.hoisted(() => vi.fn());

vi.mock("@htwang-contrib/common", async (importOriginal) => ({
  ...(await importOriginal<typeof Common>()),
  systemOne: mockSystemOne,
}));

beforeEach(() => mockSystemOne.mockReset());

describe("Bash assessment", () => {
  test("asks two independent noul questions over the actual command and working directory", async () => {
    mockSystemOne.mockResolvedValueOnce({
      answers: { destructive: { noul: 0.9 }, exfiltration: { noul: 0.8 } },
    });
    const signal = new AbortController().signal;
    expect(await assessBashCommand("test command", "/project", signal)).toEqual({
      destructive: 0.9,
      exfiltration: 0.8,
    });
    expect(mockSystemOne).toHaveBeenCalledWith(
      {
        state: { command: "test command", cwd: "/project" },
        questions: {
          destructive: expect.objectContaining({ type: "noul" }),
          exfiltration: expect.objectContaining({ type: "noul" }),
        },
      },
      { signal },
    );
  });

  test.each([-0.1, 1.1, Number.NaN, undefined])("rejects invalid scores (%s)", async (value) => {
    mockSystemOne.mockResolvedValueOnce({
      answers: { destructive: { noul: value }, exfiltration: { noul: 0.1 } },
    });
    await expect(assessBashCommand("test", "/project", new AbortController().signal)).rejects.toThrow("invalid");
  });
});
