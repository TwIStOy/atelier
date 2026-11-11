import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { routePointer } from "../src/state/key-router.ts";
import type { PointerTarget } from "../src/state/pointer-target.ts";
import { QuestionnaireSession } from "../src/state/questionnaire-session.ts";
import type { QuestionnaireRuntime } from "../src/state/state.ts";
import type { QuestionnaireResult, QuestionParams } from "../src/tool/types.ts";
import type { WrappingSelectItem } from "../src/view/components/wrapping-select.ts";
import { baseState } from "./helpers.ts";

const PLAIN_THEME = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

function itemsFor(params: QuestionParams): WrappingSelectItem[][] {
  return params.questions.map((q) => {
    const items: WrappingSelectItem[] = q.options.map((o) => ({
      kind: "option" as const,
      label: o.label,
      description: o.description,
    }));
    if (q.multiSelect) items.push({ kind: "next" as const, label: "Next" });
    else items.push({ kind: "other" as const, label: "Type something." });
    return items;
  });
}

function makeSession(params: QuestionParams) {
  const done = vi.fn<(result: QuestionnaireResult) => void>();
  const session = new QuestionnaireSession({
    tui: { terminal: { columns: 120, rows: 40 }, requestRender: vi.fn() },
    theme: PLAIN_THEME,
    params,
    itemsByTab: itemsFor(params),
    keybindings: { matches: () => false },
    editInput: vi.fn(async () => undefined),
    done,
  });
  return { session, done };
}

function mouseEvent(type: "press" | "click", x: number, y: number, width: number): TuiMouseEvent {
  return {
    type,
    button: "left",
    x,
    y,
    screenX: x,
    screenY: y,
    width,
    height: 0,
    shift: false,
    alt: false,
    ctrl: false,
  };
}

const WIDTH = 120;

/** Paint, then replay the press/click pair pi synthesizes for a stationary left-button gesture. */
function clickAt(session: QuestionnaireSession, x: number, y: number, overrides: Partial<TuiMouseEvent> = {}) {
  const rows = session.component.render(WIDTH);
  const press = { ...mouseEvent("press", x, y, WIDTH), ...overrides };
  const pressResult = session.component.handleMouse(press);
  const clickResult = session.component.handleMouse({ ...press, type: "click" });
  return { rows, pressResult, clickResult };
}

/** Row index of the first painted line containing `needle`. */
function rowOf(rows: readonly string[], needle: string): number {
  return rows.findIndex((row) => row.includes(needle));
}

const singleSelect: QuestionParams = {
  questions: [
    {
      question: "Which target?",
      header: "Target",
      options: [
        { label: "Alpha", description: "" },
        { label: "Beta", description: "" },
        { label: "Gamma", description: "" },
      ],
    },
  ],
};

describe("routePointer — action sequences", () => {
  const question = {
    question: "Q?",
    header: "H",
    options: [
      { label: "A", description: "" },
      { label: "B", description: "" },
    ],
  };
  const runtime: QuestionnaireRuntime = {
    keybindings: { matches: () => false },
    inputBuffer: "",
    canMoveInputUp: false,
    canMoveInputDown: false,
    questions: [question],
    isMulti: false,
    currentItem: { kind: "option", label: "A" },
    items: [
      { kind: "option", label: "A" },
      { kind: "option", label: "B" },
      { kind: "other", label: "Type something." },
    ],
  };

  it("focuses and commits a single-select option", () => {
    const actions = routePointer({ kind: "option", index: 1 }, baseState(), runtime);
    expect(actions[0]).toEqual({ kind: "nav", nextIndex: 1 });
    expect(actions[1]).toMatchObject({ kind: "confirm", answer: { kind: "option", answer: "B" } });
  });

  it("only focuses the sentinel that opens the inline input", () => {
    expect(routePointer({ kind: "option", index: 2 }, baseState(), runtime)).toEqual([{ kind: "nav", nextIndex: 2 }]);
  });

  it("toggles a multi-select option and commits the question from the Next row", () => {
    const multiRuntime: QuestionnaireRuntime = {
      ...runtime,
      questions: [{ ...question, multiSelect: true }],
      items: [
        { kind: "option", label: "A" },
        { kind: "option", label: "B" },
        { kind: "next", label: "Next" },
      ],
    };
    const checked = baseState({ multiSelectChecked: new Set([0]) });

    expect(routePointer({ kind: "option", index: 1 }, checked, multiRuntime)).toEqual([
      { kind: "nav", nextIndex: 1 },
      { kind: "toggle", index: 1 },
    ]);
    expect(routePointer({ kind: "option", index: 2 }, checked, multiRuntime)[1]).toMatchObject({
      kind: "multi_confirm",
      selected: ["A"],
    });
  });

  it("switches to the clicked tab and ignores the already-active one", () => {
    const multiRuntime: QuestionnaireRuntime = { ...runtime, isMulti: true, questions: [question, question] };
    expect(routePointer({ kind: "tab", index: 1 }, baseState(), multiRuntime)).toEqual([
      { kind: "tab_switch", nextTab: 1 },
    ]);
    expect(routePointer({ kind: "submit_tab" }, baseState(), multiRuntime)).toEqual([
      { kind: "tab_switch", nextTab: 2 },
    ]);
    expect(routePointer({ kind: "tab", index: 0 }, baseState(), multiRuntime)).toEqual([]);
    expect(routePointer({ kind: "tab", index: 9 }, baseState(), multiRuntime)).toEqual([]);
  });

  it("maps the submit picker rows to submit and cancel", () => {
    expect(routePointer({ kind: "submit_choice", index: 0 }, baseState(), runtime)).toEqual([{ kind: "submit" }]);
    expect(routePointer({ kind: "submit_choice", index: 1 }, baseState(), runtime)).toEqual([{ kind: "cancel" }]);
  });

  it("ignores every click while the notes editor owns the dialog", () => {
    const notes = baseState({ notesVisible: true });
    for (const target of [
      { kind: "tab", index: 1 },
      { kind: "submit_tab" },
      { kind: "option", index: 0 },
      { kind: "submit_choice", index: 0 },
    ] satisfies PointerTarget[]) {
      expect(routePointer(target, notes, runtime)).toEqual([]);
    }
  });
});

describe("QuestionnaireSession — click dispatch", () => {
  it("commits the clicked single-select option", () => {
    const { session, done } = makeSession(singleSelect);
    const rows = session.component.render(WIDTH);
    const y = rowOf(rows, "Beta");

    const { pressResult, clickResult } = clickAt(session, 2, y);

    expect(pressResult).toMatchObject({ handled: true, render: false });
    expect(clickResult).toMatchObject({ handled: true });
    expect(done).toHaveBeenCalledOnce();
    expect(done.mock.calls[0]![0].answers[0]).toMatchObject({ kind: "option", answer: "Beta" });
  });

  it("focuses the inline input row instead of committing it", () => {
    const { session, done } = makeSession(singleSelect);
    const y = rowOf(session.component.render(WIDTH), "Type something.");

    clickAt(session, 2, y);

    expect(done).not.toHaveBeenCalled();
    expect(session.component.render(WIDTH).some((row) => row.includes("❯"))).toBe(true);
  });

  it("toggles a multi-select row and commits from the Next row", () => {
    const multiSelect: QuestionParams = {
      questions: [
        {
          question: "Which?",
          header: "Pick",
          multiSelect: true,
          options: [
            { label: "Alpha", description: "" },
            { label: "Beta", description: "" },
          ],
        },
      ],
    };
    const { session, done } = makeSession(multiSelect);

    clickAt(session, 2, rowOf(session.component.render(WIDTH), "Beta"));
    expect(session.component.render(WIDTH).some((row) => row.includes("[✔] Beta"))).toBe(true);

    clickAt(session, 2, rowOf(session.component.render(WIDTH), "Submit"));
    expect(done).toHaveBeenCalledOnce();
    expect(done.mock.calls[0]![0].answers[0]).toMatchObject({ kind: "multi", selected: ["Beta"] });
  });

  it("switches tabs from the tab bar", () => {
    const params: QuestionParams = {
      questions: [
        { question: "First question?", header: "First", options: [{ label: "Alpha", description: "" }] },
        { question: "Second question?", header: "Second", options: [{ label: "Beta", description: "" }] },
      ],
    };
    const { session } = makeSession(params);
    const rows = session.component.render(WIDTH);
    const tabRow = rowOf(rows, "Second");
    const x = rows[tabRow]!.indexOf("Second");

    clickAt(session, x + 1, tabRow);

    expect(session.component.render(WIDTH).some((row) => row.includes("Second question?"))).toBe(true);
  });

  it("submits and cancels from the submit picker", () => {
    const params: QuestionParams = {
      questions: [
        { question: "First?", header: "First", options: [{ label: "Alpha", description: "" }] },
        { question: "Second?", header: "Second", options: [{ label: "Beta", description: "" }] },
      ],
    };
    const submit = makeSession(params);
    const tabRow = rowOf(submit.session.component.render(WIDTH), "Submit");
    clickAt(submit.session, submit.session.component.render(WIDTH)[tabRow]!.indexOf("Submit") + 1, tabRow);
    clickAt(submit.session, 2, rowOf(submit.session.component.render(WIDTH), "Submit answers"));
    expect(submit.done).toHaveBeenCalledOnce();
    expect(submit.done.mock.calls[0]![0].cancelled).toBe(false);

    const cancel = makeSession(params);
    const cancelTabRow = rowOf(cancel.session.component.render(WIDTH), "Submit");
    clickAt(cancel.session, cancel.session.component.render(WIDTH)[cancelTabRow]!.indexOf("Submit") + 1, cancelTabRow);
    clickAt(cancel.session, 2, rowOf(cancel.session.component.render(WIDTH), "Cancel"));
    expect(cancel.done.mock.calls[0]![0].cancelled).toBe(true);
  });

  it("leaves borders, padding, and the gap between tabs click-through", () => {
    const params: QuestionParams = {
      questions: [
        { question: "First?", header: "First", options: [{ label: "Alpha", description: "" }] },
        { question: "Second?", header: "Second", options: [{ label: "Beta", description: "" }] },
      ],
    };
    const { session, done } = makeSession(params);
    const rows = session.component.render(WIDTH);
    const tabRow = rowOf(rows, "Second");

    expect(clickAt(session, 0, 0).pressResult).toBeUndefined();
    expect(clickAt(session, 0, tabRow).pressResult).toBeUndefined();
    expect(clickAt(session, 2, rows.length - 1).pressResult).toBeUndefined();
    expect(done).not.toHaveBeenCalled();
  });

  it("ignores repeat clicks so a double click does not toggle twice", () => {
    const multiSelect: QuestionParams = {
      questions: [
        { question: "Which?", header: "Pick", multiSelect: true, options: [{ label: "Alpha", description: "" }] },
      ],
    };
    const { session } = makeSession(multiSelect);
    const y = rowOf(session.component.render(WIDTH), "Alpha");

    clickAt(session, 2, y);
    clickAt(session, 2, y, { clickCount: 2 });

    expect(session.component.render(WIDTH).some((row) => row.includes("[✔] Alpha"))).toBe(true);
  });

  it("keeps hit-testing aligned while the body is scrolled", () => {
    const many: QuestionParams = {
      questions: [
        {
          question: "Which?",
          header: "Pick",
          options: Array.from({ length: 12 }, (_, i) => ({ label: `Option${i}`, description: "" })),
        },
      ],
    };
    const done = vi.fn<(result: QuestionnaireResult) => void>();
    const session = new QuestionnaireSession({
      tui: { terminal: { columns: 60, rows: 14 }, requestRender: vi.fn() },
      theme: PLAIN_THEME,
      params: many,
      itemsByTab: itemsFor(many),
      keybindings: { matches: () => false },
      editInput: vi.fn(async () => undefined),
      done,
    });

    for (let i = 0; i < 9; i++) session.component.handleInput("\x1b[B");
    const rows = session.component.render(60);
    // The body is scrolled: the marker row proves the click runs against the windowed output.
    expect(rows.some((row) => row.includes("↑") || row.includes("↓"))).toBe(true);
    const y = rows.findIndex((row) => row.includes("❯"));
    const label = /Option\d+/.exec(rows[y]!)?.[0] ?? "";
    expect(label).not.toBe("");

    clickAt(session, 2, y);

    expect(done).toHaveBeenCalledOnce();
    expect(done.mock.calls[0]![0].answers[0]).toMatchObject({ answer: label });
  });
});
