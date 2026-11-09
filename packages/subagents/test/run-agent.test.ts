import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import {
  assistantMessageText,
  extractAssistantText,
  finalTurnError,
  parseThinking,
} from "@htwang-contrib/common/child-agent";
import { describe, expect, it } from "vitest";

function text(value: string): TextContent {
  return { type: "text", text: value };
}

function assistant(over: Partial<AssistantMessage>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "anthropic",
    provider: "anthropic",
    model: "claude",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
    ...over,
  };
}

describe("parseThinking (#147)", () => {
  it("accepts every advertised level including max", () => {
    expect(parseThinking("off")).toBe("off");
    expect(parseThinking("minimal")).toBe("minimal");
    expect(parseThinking("low")).toBe("low");
    expect(parseThinking("medium")).toBe("medium");
    expect(parseThinking("high")).toBe("high");
    expect(parseThinking("xhigh")).toBe("xhigh");
    expect(parseThinking("max")).toBe("max");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(parseThinking("  MAX  ")).toBe("max");
    expect(parseThinking("Medium")).toBe("medium");
  });

  it("rejects unknown levels and empty input", () => {
    expect(parseThinking("ultra")).toBeUndefined();
    expect(parseThinking("")).toBeUndefined();
    expect(parseThinking(undefined)).toBeUndefined();
  });
});

describe("assistantMessageText", () => {
  it("joins text parts and trims", () => {
    const msg = assistant({
      content: [text("hello "), text("world "), { type: "toolCall" } as unknown as TextContent],
    });
    expect(assistantMessageText(msg)).toBe("hello world");
  });

  it("returns empty for a content array with no text", () => {
    expect(assistantMessageText(assistant({ content: [] }))).toBe("");
  });
});

describe("extractAssistantText", () => {
  it("returns the text of the last assistant message that produced any", () => {
    const messages: AgentMessage[] = [
      assistant({ content: [text("first answer")] }),
      assistant({ content: [text("second answer")] }),
    ];
    expect(extractAssistantText(messages)).toBe("second answer");
  });

  it("walks back past an empty final assistant to the previous turn's text", () => {
    const messages: AgentMessage[] = [assistant({ content: [text("earlier turn")] }), assistant({ content: [] })];
    expect(extractAssistantText(messages)).toBe("earlier turn");
  });

  it("returns empty when no assistant message has text", () => {
    const messages: AgentMessage[] = [assistant({ content: [] })];
    expect(extractAssistantText(messages)).toBe("");
  });
});

describe("finalTurnError (#144)", () => {
  it("flags a final turn that stopped with a provider error", () => {
    const messages: AgentMessage[] = [
      assistant({ content: [text("partial")] }),
      assistant({ content: [], stopReason: "error", errorMessage: "retries exhausted: 529 overloaded" }),
    ];
    expect(finalTurnError(messages)).toBe("retries exhausted: 529 overloaded");
  });

  it("falls back to a default message when the error carried no errorMessage", () => {
    const messages: AgentMessage[] = [assistant({ content: [], stopReason: "error" })];
    expect(finalTurnError(messages)).toBe("provider error with no output");
  });

  it("flags a silent max-token death: length stop with no text", () => {
    const messages: AgentMessage[] = [assistant({ content: [], stopReason: "length" })];
    expect(finalTurnError(messages)).toBe("hit output token limit without producing any text");
  });

  it("does NOT flag a length stop that produced text (legitimate truncated answer)", () => {
    const messages: AgentMessage[] = [assistant({ content: [text("truncated answ")], stopReason: "length" })];
    expect(finalTurnError(messages)).toBeUndefined();
  });

  it("does NOT flag a clean stop, even with no text (tool-call-only or thinking-only ending)", () => {
    const messages: AgentMessage[] = [assistant({ content: [], stopReason: "stop" })];
    expect(finalTurnError(messages)).toBeUndefined();
  });

  it("only inspects the FINAL assistant turn", () => {
    const messages: AgentMessage[] = [
      assistant({ content: [], stopReason: "error", errorMessage: "earlier failure" }),
      assistant({ content: [text("recovered")], stopReason: "stop" }),
    ];
    expect(finalTurnError(messages)).toBeUndefined();
  });

  it("returns undefined when there is no assistant message at all", () => {
    expect(finalTurnError([])).toBeUndefined();
  });
});
