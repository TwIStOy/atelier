import { describe, expect, it } from "vitest";
import { routeKey } from "../src/state/key-router.ts";
import type { QuestionnaireRuntime, QuestionnaireState } from "../src/state/state.ts";
import { type ApplyContext, reduce } from "../src/state/state-reducer.ts";
import type { QuestionAnswer, QuestionData } from "../src/tool/types.ts";
import { buildHintText } from "../src/view/tab-content-strategy.ts";

const singleSelectQuestion: QuestionData = {
  question: "Which option?",
  header: "Q1",
  options: [
    { label: "Alpha", description: "first" },
    { label: "Beta", description: "second" },
  ],
};

const multiSelectQuestion: QuestionData = {
  question: "Which options?",
  header: "Q1",
  multiSelect: true,
  options: [
    { label: "Alpha", description: "first" },
    { label: "Beta", description: "second" },
  ],
};

const singleWithPreview: QuestionData = {
  question: "Which?",
  header: "Q1",
  options: [
    { label: "Alpha", description: "first", preview: "# Alpha preview" },
    { label: "Beta", description: "second" },
  ],
};

function optionAnswer(tab: number, label: string, notes?: string): QuestionAnswer {
  const base: QuestionAnswer = { questionIndex: tab, question: "q", kind: "option", answer: label };
  if (notes !== undefined) base.notes = notes;
  return base;
}

function makeState(over: Partial<QuestionnaireState> = {}): QuestionnaireState {
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
    ...over,
  };
}

function makeRuntime(over: Partial<QuestionnaireRuntime> = {}): QuestionnaireRuntime {
  return {
    keybindings: { matches: () => false },
    inputBuffer: "",
    questions: [singleSelectQuestion],
    isMulti: false,
    currentItem: undefined,
    items: [],
    ...over,
  };
}

function makeCtx(over: Partial<ApplyContext> = {}): ApplyContext {
  return {
    questions: [singleSelectQuestion],
    itemsByTab: [[]],
    inputBuffer: "",
    ...over,
  };
}

describe("routeKey — n activates notes on every question tab", () => {
  it("opens notes on a single-select tab whose focused option has no preview", () => {
    const state = makeState();
    const runtime = makeRuntime({ questions: [singleSelectQuestion] });
    expect(routeKey("n", state, runtime)).toEqual({ kind: "notes_enter" });
  });

  it("opens notes on a single-select tab whose focused option carries a preview", () => {
    const state = makeState();
    const runtime = makeRuntime({ questions: [singleWithPreview] });
    expect(routeKey("n", state, runtime)).toEqual({ kind: "notes_enter" });
  });

  it("opens notes on a multi-select tab (not swallowed by the Space/Enter branches)", () => {
    const state = makeState();
    const runtime = makeRuntime({ questions: [multiSelectQuestion] });
    expect(routeKey("n", state, runtime)).toEqual({ kind: "notes_enter" });
  });

  it("does NOT open notes while typing a custom answer (inputMode)", () => {
    const state = makeState({ inputMode: true });
    const runtime = makeRuntime({ questions: [singleSelectQuestion] });
    expect(routeKey("n", state, runtime)).toEqual({ kind: "ignore" });
  });

  it("does NOT open notes on the submit tab", () => {
    const state = makeState({ currentTab: 2 });
    const runtime = makeRuntime({ questions: [singleSelectQuestion, multiSelectQuestion], isMulti: true });
    expect(routeKey("n", state, runtime)).toEqual({ kind: "ignore" });
  });

  it("still toggles on Space in a multi-select tab (n hoist does not steal Space)", () => {
    const state = makeState({ optionIndex: 0 });
    const runtime = makeRuntime({ questions: [multiSelectQuestion] });
    expect(routeKey(" ", state, runtime)).toEqual({ kind: "toggle", index: 0 });
  });
});

describe("reduce — unconfirmed notes survive reopen and tab switches", () => {
  it("notes_enter restores unconfirmed notes from notesByTab first", () => {
    const state = makeState({
      currentTab: 0,
      notesByTab: new Map([[0, "unconfirmed draft"]]),
      answers: new Map([[0, optionAnswer(0, "Alpha", "confirmed note")]]),
    });
    const res = reduce(state, { kind: "notes_enter" }, makeCtx());
    expect(res.state.notesVisible).toBe(true);
    expect(res.state.notesDraft).toBe("unconfirmed draft");
    expect(res.effects).toContainEqual({ kind: "set_notes_value", value: "unconfirmed draft" });
  });

  it("notes_enter falls back to the confirmed answer's notes when no unconfirmed draft exists", () => {
    const state = makeState({
      currentTab: 0,
      answers: new Map([[0, optionAnswer(0, "Alpha", "confirmed note")]]),
    });
    const res = reduce(state, { kind: "notes_enter" }, makeCtx());
    expect(res.state.notesDraft).toBe("confirmed note");
    expect(res.effects).toContainEqual({ kind: "set_notes_value", value: "confirmed note" });
  });

  it("notes_enter yields an empty draft when neither source has notes", () => {
    const state = makeState({ currentTab: 0 });
    const res = reduce(state, { kind: "notes_enter" }, makeCtx());
    expect(res.state.notesDraft).toBe("");
    expect(res.effects).toContainEqual({ kind: "set_notes_value", value: "" });
  });

  it("notes_exit persists a non-empty draft into notesByTab and mirrors it onto the answer", () => {
    const state = makeState({
      currentTab: 0,
      notesDraft: "  keep me  ",
      answers: new Map([[0, optionAnswer(0, "Alpha")]]),
    });
    const res = reduce(state, { kind: "notes_exit" }, makeCtx());
    expect(res.state.notesVisible).toBe(false);
    expect(res.state.notesByTab.get(0)).toBe("keep me");
    expect(res.state.answers.get(0)?.notes).toBe("keep me");
  });

  it("notes_exit strips notes from both notesByTab and a confirmed answer when the draft is blank", () => {
    const state = makeState({
      currentTab: 0,
      notesDraft: "   ",
      notesByTab: new Map([[0, "old"]]),
      answers: new Map([[0, optionAnswer(0, "Alpha", "old")]]),
    });
    const res = reduce(state, { kind: "notes_exit" }, makeCtx());
    expect(res.state.notesByTab.has(0)).toBe(false);
    expect(res.state.answers.get(0)?.notes).toBeUndefined();
  });

  it("tab_switch restores notes via the same priority (unconfirmed draft wins)", () => {
    const state = makeState({
      currentTab: 0,
      notesByTab: new Map([[1, "tab1 draft"]]),
      answers: new Map([[1, optionAnswer(1, "Beta", "tab1 confirmed")]]),
    });
    const res = reduce(
      state,
      { kind: "tab_switch", nextTab: 1 },
      makeCtx({ questions: [singleSelectQuestion, multiSelectQuestion], itemsByTab: [[], []] }),
    );
    expect(res.state.currentTab).toBe(1);
    expect(res.state.notesDraft).toBe("tab1 draft");
    expect(res.effects).toContainEqual({ kind: "set_notes_value", value: "tab1 draft" });
  });
});

describe("buildHintText — advertises n on every question tab except inputMode", () => {
  it("shows the notes chip on a single-select tab without a preview", () => {
    expect(buildHintText(singleSelectQuestion, false, makeState())).toContain("n to add notes");
  });

  it("shows the notes chip on a single-select tab with a preview", () => {
    expect(buildHintText(singleWithPreview, false, makeState())).toContain("n to add notes");
  });

  it("shows the notes chip on a multi-select tab", () => {
    expect(buildHintText(multiSelectQuestion, false, makeState())).toContain("n to add notes");
  });

  it("hides the notes chip while in inputMode", () => {
    expect(buildHintText(singleSelectQuestion, false, makeState({ inputMode: true }))).not.toContain("n to add notes");
  });

  it("hides the notes chip while notes mode is active", () => {
    expect(buildHintText(singleSelectQuestion, false, makeState({ notesVisible: true }))).not.toContain(
      "n to add notes",
    );
  });
});
