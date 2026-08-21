import { describe, expect, it } from "vitest";
import { sanitizeModelText, sanitizeQuestionnaire } from "../src/tool/sanitize-questionnaire.ts";
import type { QuestionParams } from "../src/tool/types.ts";

describe("sanitizeModelText", () => {
  it("strips CR spam while keeping surrounding text intact", () => {
    expect(sanitizeModelText("共识成立\r\r\r\r\r\r\r\r，后续动作\r\r")).toBe("共识成立，后续动作");
  });

  it("normalizes CRLF to LF and drops lone CR", () => {
    expect(sanitizeModelText("a\r\nb\rc\rd")).toBe("a\nbcd");
  });

  it("keeps tabs and newlines", () => {
    expect(sanitizeModelText("a\tb\nc")).toBe("a\tb\nc");
  });

  it("strips C0 controls, DEL, and C1 bytes", () => {
    expect(sanitizeModelText("a\x00b\x07c\x1bd\x7fe\x9bf")).toBe("abcdef");
  });

  it("leaves plain text and CJK untouched", () => {
    expect(sanitizeModelText("plain ✅ 中文字符")).toBe("plain ✅ 中文字符");
  });

  it("keeps box-drawing characters and markdown fences intact", () => {
    const box = "┌──────┐\n│ data │\n└──────┘";
    expect(sanitizeModelText(box)).toBe(box);
    expect(sanitizeModelText("```ts\nconst x = 1;\n```")).toBe("```ts\nconst x = 1;\n```");
  });
});

describe("sanitizeQuestionnaire", () => {
  const dirty: QuestionParams = {
    questions: [
      {
        question: "Which?\r",
        header: "Pick\r\r",
        options: [
          { label: "A\r\r", description: "first\r\r\r", preview: "# A\r\nbody\r" },
          { label: "B", description: "second" },
        ],
        multiSelect: true,
      },
      {
        question: "Which two?",
        header: "Second",
        options: [
          { label: "C", description: "third" },
          { label: "D", description: "fourth" },
        ],
      },
    ],
  };

  it("sanitizes every text field, preserves structure and flags", () => {
    const clean = sanitizeQuestionnaire(dirty);
    expect(clean.questions[0]).toEqual({
      question: "Which?",
      header: "Pick",
      options: [
        { label: "A", description: "first", preview: "# A\nbody" },
        { label: "B", description: "second" },
      ],
      multiSelect: true,
    });
    expect(clean.questions[1]?.multiSelect).toBeUndefined();
  });

  it("does not mutate the input", () => {
    const snapshot = JSON.stringify(dirty);
    sanitizeQuestionnaire(dirty);
    expect(JSON.stringify(dirty)).toBe(snapshot);
  });

  it("keeps absent preview absent", () => {
    const clean = sanitizeQuestionnaire(dirty);
    expect(clean.questions[1]?.options[0]).not.toHaveProperty("preview");
  });
});
