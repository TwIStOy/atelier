import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { estimateTotalTokens } from "../src/index.ts";

function userMessage(text: string): AgentMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: 1 } as AgentMessage;
}

function assistantMessage(options?: {
  usage?: { totalTokens?: number; input: number; output: number; cacheRead: number; cacheWrite: number };
  stopReason?: string;
  text?: string;
}): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: options?.text ?? "hi" }],
    timestamp: 2,
    ...(options?.stopReason ? { stopReason: options.stopReason } : {}),
    ...(options?.usage ? { usage: options.usage } : {}),
  } as AgentMessage;
}

describe("estimateTotalTokens usage anchoring", () => {
  it("anchors at the last assistant message with real usage and estimates only the tail", () => {
    const messages = [
      userMessage("a much longer user message than the rest to make its estimate distinct"),
      assistantMessage({ usage: { totalTokens: 5000, input: 1000, output: 10, cacheRead: 0, cacheWrite: 0 } }),
      userMessage("hello"),
      assistantMessage({ usage: { totalTokens: 9000, input: 2000, output: 20, cacheRead: 0, cacheWrite: 0 } }),
      userMessage("hello"),
      userMessage("world"),
    ];
    const trailing = estimateTokens(userMessage("hello")) + estimateTokens(userMessage("world"));
    expect(estimateTotalTokens(messages)).toBe(9000 + trailing);
  });

  it("prefers totalTokens over the component sum when present", () => {
    const messages = [
      assistantMessage({
        usage: { totalTokens: 1234, input: 100, output: 100, cacheRead: 100, cacheWrite: 100 },
      }),
    ];
    expect(estimateTotalTokens(messages)).toBe(1234);
  });

  it("sums components when totalTokens is missing", () => {
    const messages = [assistantMessage({ usage: { input: 100, output: 40, cacheRead: 500, cacheWrite: 7 } })];
    expect(estimateTotalTokens(messages)).toBe(647);
  });

  it("skips aborted, errored, and zero-usage assistants when looking for an anchor", () => {
    const aborted = assistantMessage({
      stopReason: "aborted",
      usage: { totalTokens: 7777, input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    });
    const errored = assistantMessage({
      stopReason: "error",
      usage: { totalTokens: 8888, input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    });
    const zero = assistantMessage({ usage: { totalTokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
    const good = assistantMessage({ usage: { totalTokens: 3000, input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } });
    const messages = [good, zero, errored, aborted, userMessage("hello")];
    const trailing = [zero, errored, aborted, userMessage("hello")].reduce((sum, msg) => sum + estimateTokens(msg), 0);
    expect(estimateTotalTokens(messages)).toBe(3000 + trailing);
  });

  it("falls back to a pure per-message estimate before any usage exists", () => {
    const messages = [userMessage("hello"), assistantMessage(), userMessage("hello")];
    const expected = messages.reduce((sum, msg) => sum + estimateTokens(msg), 0);
    expect(estimateTotalTokens(messages)).toBe(expected);
  });
});
