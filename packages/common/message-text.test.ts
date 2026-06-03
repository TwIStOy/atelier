import { describe, expect, test } from "vitest";
import {
  extractMessageText,
  userMessageText,
  assistantMessageText,
} from "./message-text.ts";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";

describe("extractMessageText", () => {
  test("with string content", () => {
    expect(extractMessageText("hello world")).toBe("hello world");
  });

  test("with array content (text parts only)", () => {
    const content = [
      { type: "text" as const, text: "hello " },
      { type: "text" as const, text: "world" },
    ];
    expect(extractMessageText(content)).toBe("hello world");
  });

  test("with mixed parts (text + non-text, skips non-text)", () => {
    const content = [
      { type: "text" as const, text: "before " },
      { type: "image" as const, data: "abc", mimeType: "image/png" },
      { type: "text" as const, text: "after" },
    ];
    expect(extractMessageText(content)).toBe("before after");
  });
});

describe("userMessageText", () => {
  test("with string content", () => {
    const msg: UserMessage = { role: "user", content: "hi", timestamp: 0 };
    expect(userMessageText(msg)).toBe("hi");
  });

  test("with array content", () => {
    const msg: UserMessage = {
      role: "user",
      content: [
        { type: "text", text: "part1 " },
        { type: "text", text: "part2" },
      ],
      timestamp: 0,
    };
    expect(userMessageText(msg)).toBe("part1 part2");
  });
});

describe("assistantMessageText", () => {
  test("skips toolCall parts", () => {
    const msg = {
      role: "assistant" as const,
      content: [
        { type: "text" as const, text: "answer" },
        {
          type: "toolCall" as const,
          id: "tc1",
          name: "tool",
          arguments: {},
        },
        { type: "text" as const, text: " more" },
      ],
      api: "anthropic" as any,
      provider: "anthropic" as any,
      model: "test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 },
      },
      stopReason: "stop" as const,
      timestamp: 0,
    } satisfies AssistantMessage;
    expect(assistantMessageText(msg)).toBe("answer more");
  });
});
