import { describe, expect, test } from "vitest";
import {
  ActivityTracker,
  assistantTitleFromMessage,
  clipText,
  formatUserPrompt,
  sessionKeyFor,
  summarizeAskUserQuestion,
} from "./activity.ts";

describe("clipText", () => {
  test("trims whitespace and clips long text with ellipsis", () => {
    expect(clipText("  hello  ", 100)).toBe("hello");
    expect(clipText("abcdefghij", 5)).toBe("abcd…");
  });

  test("returns empty for whitespace-only input", () => {
    expect(clipText("   ", 10)).toBe("");
  });
});

describe("formatUserPrompt", () => {
  test("clips to prompt max", () => {
    const long = "x".repeat(300);
    const out = formatUserPrompt(long);
    expect(out.length).toBe(200);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("assistantTitleFromMessage", () => {
  test("extracts first text from assistant message", () => {
    const title = assistantTitleFromMessage({
      role: "assistant",
      content: [{ type: "text", text: "Hello world" }],
    });
    expect(title).toBe("Hello world");
  });

  test("returns empty for non-assistant message", () => {
    expect(
      assistantTitleFromMessage({
        role: "user",
        content: [{ type: "text", text: "hi" }],
      }),
    ).toBe("");
  });

  test("clips long assistant text", () => {
    const title = assistantTitleFromMessage({
      role: "assistant",
      content: [{ type: "text", text: "y".repeat(200) }],
    });
    expect(title.length).toBe(80);
    expect(title.endsWith("…")).toBe(true);
  });

  test("returns empty for null/garbage", () => {
    expect(assistantTitleFromMessage(null)).toBe("");
    expect(assistantTitleFromMessage("nope")).toBe("");
  });
});

describe("sessionKeyFor", () => {
  test("uses sessionID when present", () => {
    expect(sessionKeyFor("abc", "/cwd")).toBe("abc");
  });
  test("falls back to cwd-qualified key when sessionID empty", () => {
    expect(sessionKeyFor("", "/cwd")).toBe("cwd:/cwd");
    expect(sessionKeyFor(undefined, "/cwd")).toBe("cwd:/cwd");
  });
});

describe("ActivityTracker", () => {
  test("does not emit idle before any prompt is recorded", () => {
    const a = new ActivityTracker();
    a.markActive("s1");
    expect(a.shouldEmitIdle("s1").emit).toBe(false);
  });

  test("emits idle once after prompt recorded + markActive", () => {
    const a = new ActivityTracker();
    a.rememberUserPrompt("s1", "do the thing");
    a.markActive("s1");
    const first = a.shouldEmitIdle("s1");
    expect(first.emit).toBe(true);
    expect(first.prompt).toBe("do the thing");
    expect(first.title).toBe("");

    a.markIdlePublished("s1");
    expect(a.shouldEmitIdle("s1").emit).toBe(false);
  });

  test("markActive after idle allows re-emitting", () => {
    const a = new ActivityTracker();
    a.rememberUserPrompt("s1", "first");
    a.markActive("s1");
    a.markIdlePublished("s1");
    expect(a.shouldEmitIdle("s1").emit).toBe(false);

    a.markActive("s1");
    expect(a.shouldEmitIdle("s1").emit).toBe(true);
  });

  test("assistant title is surfaced in idle payload", () => {
    const a = new ActivityTracker();
    a.rememberUserPrompt("s1", "build it");
    a.rememberAssistantTitle("s1", "Running build");
    a.markActive("s1");
    const idle = a.shouldEmitIdle("s1");
    expect(idle.title).toBe("Running build");
  });

  test("sessions are tracked independently", () => {
    const a = new ActivityTracker();
    a.rememberUserPrompt("s1", "one");
    a.markActive("s1");
    expect(a.shouldEmitIdle("s2").emit).toBe(false);
  });

  test("empty prompt is ignored", () => {
    const a = new ActivityTracker();
    a.rememberUserPrompt("s1", "   ");
    a.markActive("s1");
    expect(a.shouldEmitIdle("s1").emit).toBe(false);
  });

  test("reset clears all sessions", () => {
    const a = new ActivityTracker();
    a.rememberUserPrompt("s1", "x");
    a.markActive("s1");
    a.reset();
    expect(a.shouldEmitIdle("s1").emit).toBe(false);
  });
});

describe("summarizeAskUserQuestion", () => {
  test("null/undefined payload yields fallback", () => {
    expect(summarizeAskUserQuestion(null)).toEqual({
      title: "Pi needs input",
      message: "Input requested",
      optionCount: 0,
    });
    expect(summarizeAskUserQuestion(undefined).message).toBe("Input requested");
  });

  test("uses first question text as message", () => {
    const summary = summarizeAskUserQuestion({
      questions: [
        {
          question: "Which library?",
          header: "Library",
          multiSelect: false,
          options: [
            { label: "A", description: "", hasPreview: false },
            { label: "B", description: "", hasPreview: false },
          ],
        },
      ],
    });
    expect(summary.message).toBe("Which library?");
    expect(summary.optionCount).toBe(2);
    expect(summary.title).toBe("Pi needs input");
  });

  test("falls back to header when question empty", () => {
    const summary = summarizeAskUserQuestion({
      questions: [
        {
          question: "",
          header: "Auth method",
          multiSelect: false,
          options: [],
        },
      ],
    });
    expect(summary.message).toBe("Auth method");
  });

  test("clips long question text", () => {
    const summary = summarizeAskUserQuestion({
      questions: [
        {
          question: "x".repeat(300),
          header: "",
          multiSelect: false,
          options: [],
        },
      ],
    });
    expect(summary.message.length).toBe(200);
    expect(summary.message.endsWith("…"));
  });

  test("sums options across multiple questions", () => {
    const summary = summarizeAskUserQuestion({
      questions: [
        {
          question: "q1",
          header: "",
          multiSelect: false,
          options: [{ label: "a", description: "", hasPreview: false }],
        },
        {
          question: "q2",
          header: "",
          multiSelect: true,
          options: [
            { label: "b", description: "", hasPreview: false },
            { label: "c", description: "", hasPreview: false },
          ],
        },
      ],
    });
    expect(summary.optionCount).toBe(3);
  });
});
