import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { AssistantMessage } from "@earendil-works/pi-ai";

const { executeSideCallMock } = vi.hoisted(() => ({
  executeSideCallMock: vi.fn(),
}));

vi.mock("@htwang-contrib/common", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@htwang-contrib/common")>();
  return {
    ...actual,
    executeSideCall: executeSideCallMock,
  };
});

import {
  buildSummaryPrompt,
  lastAssistantMessage,
  parseSummary,
  summarizeAgentTurn,
} from "./summarizer.ts";

const fakeRegistry = {
  getApiKeyAndHeaders: vi.fn(),
} as unknown as Parameters<typeof summarizeAgentTurn>[0]["modelRegistry"];

beforeAll(() => {
  executeSideCallMock.mockResolvedValue({ ok: false, error: "not mocked" });
});

beforeEach(() => {
  executeSideCallMock.mockClear();
});

function assistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
  } as unknown as AssistantMessage;
}

describe("buildSummaryPrompt", () => {
  test("includes user prompt and assistant reply", () => {
    const messages = buildSummaryPrompt(
      "fix the login bug",
      assistantMessage("I patched auth.ts."),
    );
    expect(messages).toHaveLength(1);
    const content = messages[0]!.content as string;
    expect(content).toContain("fix the login bug");
    expect(content).toContain("I patched auth.ts.");
    expect(content).toContain("User asked");
    expect(content).toContain("final reply");
  });

  test("substitutes placeholders for empty values", () => {
    const messages = buildSummaryPrompt("", assistantMessage(""));
    const content = messages[0]!.content as string;
    expect(content).toContain("(no prompt recorded)");
    expect(content).toContain("(empty reply)");
  });
});

describe("parseSummary", () => {
  test("parses title and summary separated by newline", () => {
    const parsed = parseSummary("Login bug fixed\nUpdated auth logic.");
    expect(parsed).toEqual({
      title: "Login bug fixed",
      message: "Updated auth logic.",
    });
  });

  test("merges multi-line summary into one message", () => {
    const parsed = parseSummary(
      "Refactor\nFirst line. Second line. Third line.",
    );
    expect(parsed!.title).toBe("Refactor");
    expect(parsed!.message).toBe("First line. Second line. Third line.");
  });

  test("clips over-long titles", () => {
    const parsed = parseSummary("x".repeat(120) + "\nshort summary");
    expect(parsed!.title.length).toBe(80);
    expect(parsed!.title.endsWith("…")).toBe(true);
  });

  test("clips over-long messages", () => {
    const parsed = parseSummary("Title\n" + "y".repeat(300));
    expect(parsed!.message.length).toBe(200);
    expect(parsed!.message.endsWith("…")).toBe(true);
  });

  test("returns null for empty input", () => {
    expect(parseSummary("")).toBeNull();
    expect(parseSummary("   \n  ")).toBeNull();
  });

  test("returns title with empty message when single line", () => {
    const parsed = parseSummary("Only a title");
    expect(parsed).toEqual({ title: "Only a title", message: "" });
  });
});

describe("lastAssistantMessage", () => {
  test("returns the last assistant message", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "first" }] },
      { role: "assistant", content: [{ type: "text", text: "final" }] },
    ];
    const msg = lastAssistantMessage(messages);
    expect(msg).toBeDefined();
    expect((msg as AssistantMessage).role).toBe("assistant");
  });

  test("returns undefined when no assistant message", () => {
    expect(
      lastAssistantMessage([{ role: "user", content: "hi" }]),
    ).toBeUndefined();
  });

  test("returns undefined for empty or invalid input", () => {
    expect(lastAssistantMessage(undefined)).toBeUndefined();
    expect(lastAssistantMessage([])).toBeUndefined();
    expect(
      lastAssistantMessage("nope" as unknown as unknown[]),
    ).toBeUndefined();
  });
});

describe("summarizeAgentTurn", () => {
  const assistant = assistantMessage("Final reply");

  test("returns model summary on success", async () => {
    executeSideCallMock.mockResolvedValueOnce({
      ok: true,
      answer: "Login fixed\nPatched auth.ts.",
      assistantMessage: assistant,
      stopReason: "done",
    });
    const outcome = await summarizeAgentTurn({
      userPrompt: "fix login",
      lastAssistant: assistant,
      model: { provider: "x", id: "y" } as never,
      modelRegistry: fakeRegistry,
      fallbackTitle: "Fallback",
      fallbackMessage: "fallback msg",
    });
    expect(outcome.fromModel).toBe(true);
    expect(outcome.title).toBe("Login fixed");
    expect(outcome.message).toBe("Patched auth.ts.");
  });

  test("falls back when no model configured", async () => {
    const outcome = await summarizeAgentTurn({
      userPrompt: "fix login",
      lastAssistant: assistant,
      model: undefined,
      modelRegistry: fakeRegistry,
      fallbackTitle: "Fallback",
      fallbackMessage: "fallback msg",
    });
    expect(outcome.fromModel).toBe(false);
    expect(outcome.title).toBe("Fallback");
    expect(outcome.message).toBe("fallback msg");
    expect(executeSideCallMock).not.toHaveBeenCalled();
  });

  test("falls back when side call fails", async () => {
    executeSideCallMock.mockResolvedValueOnce({
      ok: false,
      error: "boom",
    });
    const outcome = await summarizeAgentTurn({
      userPrompt: "fix login",
      lastAssistant: assistant,
      model: { provider: "x", id: "y" } as never,
      modelRegistry: fakeRegistry,
      fallbackTitle: "Fallback",
      fallbackMessage: "fallback msg",
    });
    expect(outcome.fromModel).toBe(false);
    expect(outcome.title).toBe("Fallback");
    expect(outcome.message).toBe("fallback msg");
  });

  test("falls back when answer is unparseable", async () => {
    executeSideCallMock.mockResolvedValueOnce({
      ok: true,
      answer: "   ",
      assistantMessage: assistant,
      stopReason: "done",
    });
    const outcome = await summarizeAgentTurn({
      userPrompt: "fix login",
      lastAssistant: assistant,
      model: { provider: "x", id: "y" } as never,
      modelRegistry: fakeRegistry,
      fallbackTitle: "Fallback",
      fallbackMessage: "fallback msg",
    });
    expect(outcome.fromModel).toBe(false);
    expect(outcome.message).toBe("fallback msg");
  });
});
