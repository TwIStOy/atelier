import type { AssistantMessage, ClassifierContext, ClassifierResult } from "@earendil-works/pi-ai";
import type { ClassifierCall } from "@htwang-contrib/common/classifier-models";
import { describe, expect, test } from "vitest";
import { classifyMessageComplexity, messageComplexityRequest } from "../src/complexity.ts";

function choiceResult(probabilities: Record<string, number>): ClassifierResult {
  return {
    api: "typesafe-system-one",
    provider: "magpie",
    model: "jev-latest",
    answers: {
      model: { type: "choice", choice: "middle", confidence: 0.9, probabilities },
    },
    stopReason: "stop",
    timestamp: 1,
  };
}

describe("message complexity", () => {
  test("asks for all three model tiers in one choice question and preserves their probabilities", async () => {
    const probabilities = { flash: 0.1, middle: 0.7, flagship: 0.2 };
    const requests: ClassifierContext[] = [];
    const classify: ClassifierCall = async (request) => {
      requests.push(request);
      return choiceResult(probabilities);
    };
    const signal = new AbortController().signal;
    const context = {
      systemPrompt: "Follow the project conventions",
      messages: [{ role: "user" as const, content: "Fix the race condition", timestamp: 1 }],
    };
    expect(await classifyMessageComplexity("Fix the race condition", context, signal, classify)).toEqual(probabilities);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual(messageComplexityRequest("Fix the race condition", context));
    expect(requests[0]).toMatchObject({
      state: {
        message: "Fix the race condition",
        context: { systemPrompt: context.systemPrompt, messages: expect.any(String) },
      },
      questions: {
        model: {
          type: "choice",
          instructions: expect.stringContaining("least expensive model tier"),
          criteria: {
            flash: expect.any(String),
            middle: expect.any(String),
            flagship: expect.any(String),
          },
        },
      },
    });
  });

  test("rejects an invalid probability before it reaches the renderer", async () => {
    const classify: ClassifierCall = async () => choiceResult({ flash: 0.1, middle: 0.7 });
    await expect(
      classifyMessageComplexity("test", { systemPrompt: "", messages: [] }, new AbortController().signal, classify),
    ).rejects.toThrow("flagship");
  });

  test("rejects a failed or malformed classifier result", async () => {
    const failed: ClassifierCall = async () =>
      ({ ...choiceResult({}), stopReason: "error", errorMessage: "gateway down" }) as ClassifierResult;
    await expect(
      classifyMessageComplexity("test", { systemPrompt: "", messages: [] }, new AbortController().signal, failed),
    ).rejects.toThrow("gateway down");

    const malformed: ClassifierCall = async () => ({ ...choiceResult({}), answers: {} }) as unknown as ClassifierResult;
    await expect(
      classifyMessageComplexity("test", { systemPrompt: "", messages: [] }, new AbortController().signal, malformed),
    ).rejects.toThrow("no model tier choice");
  });

  test("preserves conversation, tool output, summaries and image markers without forwarding image bytes", async () => {
    const requests: ClassifierContext[] = [];
    const classify: ClassifierCall = async (request) => {
      requests.push(request);
      return choiceResult({ flash: 0, middle: 0, flagship: 1 });
    };
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
      classify,
    );
    const state = requests[0]?.state as { context: { systemPrompt: string; messages: string } };
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
