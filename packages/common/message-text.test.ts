import { describe, expect, test } from "vitest";
import {
  assistantMessageText,
  extractMessageText,
  userMessageText,
} from "./message-text.ts";

describe("extractMessageText", () => {
  test("returns string content as-is", () => {
    expect(extractMessageText("hello")).toBe("hello");
  });

  test("joins text parts from array content", () => {
    const content = [
      { type: "text" as const, text: "a" },
      { type: "text" as const, text: "b" },
    ];
    expect(extractMessageText(content)).toBe("a\nb");
  });

  test("ignores non-text parts", () => {
    const content = [
      { type: "text" as const, text: "a" },
      { type: "image" as const, data: "...", mimeType: "image/png" },
    ];
    expect(extractMessageText(content)).toBe("a");
  });

  test("returns empty string for empty array", () => {
    expect(extractMessageText([])).toBe("");
  });
});

describe("userMessageText", () => {
  test("extracts from string content", () => {
    expect(
      userMessageText({
        role: "user",
        content: "hi",
        timestamp: 0,
      } as unknown as import("@earendil-works/pi-ai").UserMessage),
    ).toBe("hi");
  });

  test("extracts from array content", () => {
    expect(
      userMessageText({
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "text", text: "world" },
        ],
        timestamp: 0,
      } as unknown as import("@earendil-works/pi-ai").UserMessage),
    ).toBe("hello\nworld");
  });
});

describe("assistantMessageText", () => {
  test("joins text parts, skips toolCalls", () => {
    expect(
      assistantMessageText({
        role: "assistant",
        content: [
          { type: "text", text: "hello" },
          { type: "toolCall" as unknown as "text", text: "ignored" },
        ],
      } as unknown as import("@earendil-works/pi-ai").AssistantMessage),
    ).toBe("hello");
  });

  test("returns empty string for content without text parts", () => {
    expect(
      assistantMessageText({
        role: "assistant",
        content: [],
      } as unknown as import("@earendil-works/pi-ai").AssistantMessage),
    ).toBe("");
  });
});
