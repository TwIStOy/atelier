import { describe, expect, it } from "vitest";
import { routeKey } from "../src/state/key-router.ts";
import type { QuestionnaireRuntime } from "../src/state/state.ts";
import { baseState } from "./helpers.ts";

/** Fake keybinding resolver: `matchFor` is the name (or names) the current data should match. */
function keybindings(matchFor: string | string[] | null): QuestionnaireRuntime["keybindings"] {
  const names = matchFor === null ? [] : Array.isArray(matchFor) ? matchFor : [matchFor];
  return {
    matches: (_data: string, name: string) => names.includes(name),
  };
}

function runtime(overrides: Partial<QuestionnaireRuntime> = {}): QuestionnaireRuntime {
  return {
    keybindings: keybindings(null),
    inputBuffer: "",
    canMoveInputUp: false,
    canMoveInputDown: false,
    questions: [],
    isMulti: false,
    currentItem: undefined,
    items: [],
    ...overrides,
  };
}

describe("routeKey — inputMode multiline editing", () => {
  const inputModeState = baseState({ inputMode: true, optionIndex: 2 });
  /** One answerable single-select question + its option items, so the confirm branch can build a real answer. */
  const withAnswerableQuestion: Partial<QuestionnaireRuntime> = {
    inputBuffer: "draft",
    questions: [
      {
        question: "Q?",
        header: "H",
        options: [
          { label: "A", description: "d" },
          { label: "B", description: "d" },
        ],
      },
    ],
    items: [
      { kind: "option", label: "A" },
      { kind: "option", label: "B" },
      { kind: "other", label: "Type something." },
    ],
  };

  it("routes the newline binding to ignore so the editor inserts a line break", () => {
    const rt = runtime({
      keybindings: keybindings("tui.input.newLine"),
      ...withAnswerableQuestion,
    });

    const action = routeKey("\x1b\r", inputModeState, rt);

    expect(action).toEqual({ kind: "ignore" });
  });

  it("routes the newline binding to ignore even when the confirm binding also matches the key", () => {
    // A user config binding both semantic actions to one key: newline wins, matching
    // the newline-before-confirm ordering in the inputMode branch.
    const rt = runtime({
      keybindings: {
        matches: (_data: string, name: string) => name === "tui.input.newLine" || name === "tui.select.confirm",
      },
      ...withAnswerableQuestion,
    });

    const action = routeKey("\x1b\r", inputModeState, rt);

    expect(action).toEqual({ kind: "ignore" });
  });

  it("routes the line-kill binding to input_clear instead of forwarding the keystroke", () => {
    const rt = runtime({ keybindings: keybindings("tui.editor.deleteToLineStart") });

    const action = routeKey("\x15", inputModeState, rt);

    expect(action).toEqual({ kind: "input_clear" });
  });

  it("keeps UP as row navigation when the cursor is on the draft's first line", () => {
    const rt = runtime({
      keybindings: keybindings(["tui.editor.cursorUp", "tui.select.up"]),
      canMoveInputUp: false,
      items: [
        { kind: "option", label: "A" },
        { kind: "option", label: "B" },
        { kind: "other", label: "Type something." },
      ],
    });

    const action = routeKey("\x1b[A", inputModeState, rt);

    expect(action).toEqual({ kind: "nav", nextIndex: 1 });
  });

  it("keeps DOWN as row navigation when the cursor is on the draft's last line", () => {
    const rt = runtime({
      keybindings: keybindings(["tui.editor.cursorDown", "tui.select.down"]),
      canMoveInputDown: false,
      items: [
        { kind: "option", label: "A" },
        { kind: "option", label: "B" },
        { kind: "other", label: "Type something." },
      ],
    });

    const action = routeKey("\x1b[B", inputModeState, rt);

    expect(action).toEqual({ kind: "nav", nextIndex: 0 });
  });

  it("forwards UP to the editor while the cursor can move up within the draft", () => {
    const rt = runtime({
      keybindings: keybindings(["tui.editor.cursorUp", "tui.select.up"]),
      canMoveInputUp: true,
    });

    const action = routeKey("\x1b[A", inputModeState, rt);

    expect(action).toEqual({ kind: "ignore" });
  });

  it("forwards DOWN to the editor while the cursor can move down within the draft", () => {
    const rt = runtime({
      keybindings: keybindings(["tui.editor.cursorDown", "tui.select.down"]),
      canMoveInputDown: true,
    });

    const action = routeKey("\x1b[B", inputModeState, rt);

    expect(action).toEqual({ kind: "ignore" });
  });

  it("does not gate row navigation on the in-draft flags outside inputMode", () => {
    const rt = runtime({
      keybindings: keybindings(["tui.editor.cursorUp", "tui.select.up"]),
      canMoveInputUp: true,
      questions: [
        {
          question: "Q?",
          header: "H",
          options: [
            { label: "A", description: "d" },
            { label: "B", description: "d" },
          ],
        },
      ],
      items: [
        { kind: "option", label: "A" },
        { kind: "option", label: "B" },
      ],
    });

    const action = routeKey("\x1b[A", baseState({ optionIndex: 1 }), rt);

    expect(action).toEqual({ kind: "nav", nextIndex: 0 });
  });
});

describe("routeKey — external editor (app.editor.external)", () => {
  it("in inputMode routes Ctrl+G to input_edit carrying the current draft", () => {
    const state = baseState({ inputMode: true });
    const rt = runtime({
      keybindings: keybindings("app.editor.external"),
      inputBuffer: "my draft",
    });

    const action = routeKey("\x07", state, rt);

    expect(action).toEqual({ kind: "input_edit", value: "my draft" });
  });

  it("does not route to input_edit when not in inputMode (option navigation context)", () => {
    const state = baseState({ inputMode: false });
    const rt = runtime({
      keybindings: keybindings("app.editor.external"),
      inputBuffer: "ignored",
    });

    const action = routeKey("\x07", state, rt);

    expect(action.kind).not.toBe("input_edit");
  });

  it("does not route to input_edit while notes are visible", () => {
    const state = baseState({ inputMode: true, notesVisible: true });
    const rt = runtime({
      keybindings: keybindings("app.editor.external"),
      inputBuffer: "draft",
    });

    const action = routeKey("\x07", state, rt);

    expect(action.kind).not.toBe("input_edit");
  });
});
