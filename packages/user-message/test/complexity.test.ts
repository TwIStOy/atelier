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
    const context = {
      systemPrompt: "Follow the project conventions",
      messages: [{ role: "user" as const, content: "Fix the race condition", timestamp: 1 }],
    };
    expect(await classifyMessageComplexity("Fix the race condition", context, signal)).toEqual(probabilities);
    expect(mockSystemOne).toHaveBeenLastCalledWith(
      {
        state: {
          message: "Fix the race condition",
          context: { systemPrompt: context.systemPrompt, messages: JSON.stringify(context.messages) },
        },
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
    await expect(
      classifyMessageComplexity("test", { systemPrompt: "", messages: [] }, new AbortController().signal),
    ).rejects.toThrow("flagship");
  });

  test("preserves conversation, tool output, summaries and image markers without forwarding image bytes", async () => {
    mockSystemOne.mockResolvedValueOnce({
      answers: { model: { probabilities: { flash: 0, middle: 0, flagship: 1 } } },
    });
    const assistant: AssistantMessage = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Trace the locking order" },
        { type: "text", text: "Inspecting the transaction implementation" },
        { type: "toolCall", id: "read-1", name: "read", arguments: { path: "transactions.ts" } },
      ],
      api: "openai-responses",
      provider: "openai",
      model: "test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: 2,
    };
    const toolOutput = `${"Full implementation\n".repeat(300)}Critical race condition at the end`;
    await classifyMessageComplexity(
      "Continue",
      {
        systemPrompt: "Repository instructions",
        messages: [
          { role: "compactionSummary", summary: "Earlier debugging steps", tokensBefore: 1000, timestamp: 0 },
          { role: "branchSummary", summary: "Alternative approach", fromId: "previous", timestamp: 0 },
          {
            role: "custom",
            customType: "context",
            content: "Additional constraints",
            display: false,
            timestamp: 0,
          },
          { role: "user", content: "Investigate a distributed transaction race", timestamp: 1 },
          assistant,
          {
            role: "toolResult",
            toolCallId: "read-1",
            toolName: "read",
            content: [{ type: "text", text: toolOutput }],
            isError: false,
            timestamp: 3,
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Continue" },
              { type: "image", mimeType: "image/png", data: "image-bytes-must-not-be-in-text" },
            ],
            timestamp: 4,
          },
        ],
      },
      new AbortController().signal,
    );
    const call = mockSystemOne.mock.lastCall;
    if (!call) throw new Error("Missing System One request");
    const { state } = call[0];
    expect(state.context.systemPrompt).toBe("Repository instructions");
    const messages = JSON.parse(state.context.messages);
    expect(messages).toHaveLength(7);
    expect(messages[0].content[0].text).toContain("Earlier debugging steps");
    expect(messages[1].content[0].text).toContain("Alternative approach");
    expect(messages[2].content[0].text).toBe("Additional constraints");
    expect(messages[3].content).toBe("Investigate a distributed transaction race");
    expect(messages[4]).toEqual(assistant);
    expect(messages[5].content[0].text).toBe(toolOutput);
    expect(messages[6].content).toEqual([
      { type: "text", text: "Continue" },
      { type: "image", mimeType: "image/png" },
    ]);
    expect(state.context.messages).not.toContain("image-bytes-must-not-be-in-text");
  });
});

import type { AssistantMessage } from "@earendil-works/pi-ai";
