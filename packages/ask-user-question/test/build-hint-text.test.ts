import { describe, expect, it } from "vitest";
import { HINT_PART_CLEAR, HINT_PART_EDIT, HINT_PART_NEW_LINE } from "../src/view/dialog-text.ts";
import { buildHintText } from "../src/view/tab-content-strategy.ts";
import { baseState } from "./helpers.ts";

const question = {
  question: "Which?",
  header: "Pick",
  options: [
    { label: "A", description: "a" },
    { label: "B", description: "b" },
  ],
};

describe("buildHintText — external editor hint", () => {
  it("advertises Ctrl+G while the custom-answer row is focused (inputMode)", () => {
    const hint = buildHintText(question, false, baseState({ inputMode: true }));
    expect(hint).toContain(HINT_PART_EDIT);
  });

  it("omits the Ctrl+G hint when not in inputMode", () => {
    const hint = buildHintText(question, false, baseState({ inputMode: false }));
    expect(hint).not.toContain(HINT_PART_EDIT);
  });

  it("keeps the core Enter / navigate / cancel prefix alongside the edit hint", () => {
    const hint = buildHintText(question, false, baseState({ inputMode: true }));
    expect(hint.startsWith("Enter to select · ↑/↓ to navigate")).toBe(true);
    expect(hint).toContain("Esc to cancel");
  });
});

describe("buildHintText — multiline editing hints", () => {
  it("advertises newline and clear shortcuts in inputMode", () => {
    const hint = buildHintText(question, false, baseState({ inputMode: true }));

    expect(hint).toContain(HINT_PART_NEW_LINE);
    expect(hint).toContain(HINT_PART_CLEAR);
  });

  it("omits the newline and clear hints when not in inputMode", () => {
    const hint = buildHintText(question, false, baseState({ inputMode: false }));

    expect(hint).not.toContain(HINT_PART_NEW_LINE);
    expect(hint).not.toContain(HINT_PART_CLEAR);
  });

  it("appends the multiline shortcuts after the cancel part so clipping keeps core hints", () => {
    const hint = buildHintText(question, false, baseState({ inputMode: true }));

    expect(hint.indexOf("Esc to cancel")).toBeLessThan(hint.indexOf(HINT_PART_NEW_LINE));
    expect(hint.indexOf(HINT_PART_NEW_LINE)).toBeLessThan(hint.indexOf(HINT_PART_CLEAR));
  });
});
