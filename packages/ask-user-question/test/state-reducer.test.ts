import { describe, expect, it } from "vitest";
import { buildItemsForQuestion } from "../src/build-items.ts";
import type { QuestionnaireState } from "../src/state/state.ts";
import type { ApplyContext, ApplyResult } from "../src/state/state-reducer.ts";
import { reduce } from "../src/state/state-reducer.ts";
import type { QuestionData } from "../src/tool/types.ts";

function singleSelectQuestion(question: string, ...labels: string[]): QuestionData {
  return {
    question,
    header: "H",
    options: labels.map((label) => ({ label, description: "d" })),
  };
}

function makeCtx(questions: readonly QuestionData[], inputBuffer: string): ApplyContext {
  return {
    questions,
    itemsByTab: questions.map((q) => buildItemsForQuestion(q)),
    inputBuffer,
  };
}

function freshState(overrides: Partial<QuestionnaireState> = {}): QuestionnaireState {
  return {
    currentTab: 0,
    optionIndex: 0,
    inputMode: false,
    notesVisible: false,
    answers: new Map(),
    multiSelectChecked: new Set(),
    notesByTab: new Map(),
    customDraftsByTab: new Map(),
    submitChoiceIndex: 0,
    notesDraft: "",
    ...overrides,
  };
}

type InputBufferEffect = { kind: "set_input_buffer"; value: string } | { kind: "clear_input_buffer" };

function inputBufferEffect(result: ApplyResult): InputBufferEffect | undefined {
  return result.effects.find(
    (e): e is InputBufferEffect => e.kind === "set_input_buffer" || e.kind === "clear_input_buffer",
  );
}

function inputValue(result: ApplyResult): string | undefined {
  const e = inputBufferEffect(result);
  if (e?.kind === "set_input_buffer") return e.value;
  if (e?.kind === "clear_input_buffer") return "";
  return undefined;
}

const QUESTIONS = [singleSelectQuestion("Q1?", "a", "b"), singleSelectQuestion("Q2?", "c", "d")];
const INPUT_ROW = QUESTIONS[0].options.length;

describe("custom draft persistence", () => {
  it("captures the in-flight buffer when navigating away from the Type something. row", () => {
    const ctx = makeCtx(QUESTIONS, "hello");
    const onInputRow = freshState({ optionIndex: INPUT_ROW, inputMode: true });
    const otherRow = QUESTIONS[0].options.length;

    const leaving = reduce(onInputRow, { kind: "nav", nextIndex: otherRow - 1 }, ctx);

    expect(leaving.state.customDraftsByTab.get(0)).toBe("hello");
    expect(leaving.state.inputMode).toBe(false);
    expect(inputValue(leaving)).toBe("");
  });

  it("restores the draft verbatim when navigating back to the Type something. row", () => {
    const ctx = makeCtx(QUESTIONS, "");
    const otherRow = QUESTIONS[0].options.length;
    const afterCapture = freshState({
      optionIndex: otherRow - 1,
      inputMode: false,
      customDraftsByTab: new Map([[0, "hello"]]),
    });

    const returning = reduce(afterCapture, { kind: "nav", nextIndex: otherRow }, ctx);

    expect(returning.state.inputMode).toBe(true);
    expect(inputValue(returning)).toBe("hello");
  });

  it("restores a confirmed custom answer ahead of a stale draft", () => {
    const ctx = makeCtx(QUESTIONS, "");
    const otherRow = QUESTIONS[0].options.length;
    const withAnswer = freshState({
      optionIndex: otherRow - 1,
      inputMode: false,
      answers: new Map([[0, { questionIndex: 0, question: "Q1?", kind: "custom", answer: "committed" }]]),
      customDraftsByTab: new Map([[0, "stale-draft"]]),
    });

    const returning = reduce(withAnswer, { kind: "nav", nextIndex: otherRow }, ctx);

    expect(inputValue(returning)).toBe("committed");
  });
});

describe("custom draft does not leak across questions", () => {
  it("clears the buffer on tab switch so Q1's draft is absent from Q2", () => {
    const ctx = makeCtx(QUESTIONS, "tab0draft");
    const onInputRowQ1 = freshState({ currentTab: 0, optionIndex: INPUT_ROW, inputMode: true });

    const switched = reduce(onInputRowQ1, { kind: "tab_switch", nextTab: 1 }, ctx);

    expect(switched.state.currentTab).toBe(1);
    expect(switched.state.customDraftsByTab.get(0)).toBe("tab0draft");
    expect(inputValue(switched)).toBe("");
  });

  it("restores each tab's own draft when switching back (both directions)", () => {
    const ctx = makeCtx(QUESTIONS, "tab1draft");
    const onInputRowQ2 = freshState({
      currentTab: 1,
      optionIndex: INPUT_ROW,
      inputMode: true,
      customDraftsByTab: new Map([[0, "tab0draft"]]),
    });

    const backToQ1 = reduce(onInputRowQ2, { kind: "tab_switch", nextTab: 0 }, ctx);

    expect(backToQ1.state.customDraftsByTab.get(1)).toBe("tab1draft");
    expect(backToQ1.state.customDraftsByTab.get(0)).toBe("tab0draft");
    expect(inputValue(backToQ1)).toBe("tab0draft");
  });
});

describe("confirming an answer discards the uncommitted draft", () => {
  it("clears the draft and advances with an empty buffer after a custom confirm", () => {
    const ctx = makeCtx(QUESTIONS, "foo");
    const onInputRowQ1 = freshState({
      optionIndex: INPUT_ROW,
      inputMode: true,
      customDraftsByTab: new Map([[0, "foo"]]),
    });

    const confirmed = reduce(
      onInputRowQ1,
      {
        kind: "confirm",
        answer: { questionIndex: 0, question: "Q1?", kind: "custom", answer: "foo" },
        autoAdvanceTab: 1,
      },
      ctx,
    );

    expect(confirmed.state.answers.get(0)?.kind).toBe("custom");
    expect(confirmed.state.customDraftsByTab.has(0)).toBe(false);
    expect(inputValue(confirmed)).toBe("");
  });

  it("clears the draft after an option confirm so it does not resurface on the input row", () => {
    const ctx = makeCtx(QUESTIONS, "");
    const onOptionRow = freshState({
      optionIndex: 0,
      inputMode: false,
      customDraftsByTab: new Map([[0, "leftover"]]),
    });

    const confirmed = reduce(
      onOptionRow,
      {
        kind: "confirm",
        answer: { questionIndex: 0, question: "Q1?", kind: "option", answer: "a" },
        autoAdvanceTab: 1,
      },
      ctx,
    );

    expect(confirmed.state.customDraftsByTab.has(0)).toBe(false);

    const otherRow = QUESTIONS[0].options.length;
    const backToInput = reduce(
      { ...confirmed.state, currentTab: 0, optionIndex: otherRow - 1 },
      { kind: "nav", nextIndex: otherRow },
      ctx,
    );

    expect(inputValue(backToInput)).toBe("");
  });

  it("still restores the committed custom answer when revisiting the input row", () => {
    const ctx = makeCtx(QUESTIONS, "");
    const otherRow = QUESTIONS[0].options.length;
    const answered = freshState({
      optionIndex: otherRow - 1,
      inputMode: false,
      answers: new Map([[0, { questionIndex: 0, question: "Q1?", kind: "custom", answer: "committed" }]]),
    });

    const returning = reduce(answered, { kind: "nav", nextIndex: otherRow }, ctx);

    expect(inputValue(returning)).toBe("committed");
  });
});
