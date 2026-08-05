import { describe, expect, it } from "vitest";
import { routeKey } from "../src/state/key-router.ts";
import type { QuestionnaireRuntime } from "../src/state/state.ts";
import { baseState } from "./helpers.ts";

/** Fake keybinding resolver: `matchFor` is the single name the current data should match. */
function keybindings(matchFor: string | null): QuestionnaireRuntime["keybindings"] {
  return {
    matches: (_data: string, name: string) => name === matchFor,
  };
}

function runtime(overrides: Partial<QuestionnaireRuntime> = {}): QuestionnaireRuntime {
  return {
    keybindings: keybindings(null),
    inputBuffer: "",
    questions: [],
    isMulti: false,
    currentItem: undefined,
    items: [],
    ...overrides,
  };
}

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
