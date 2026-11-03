import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { QuestionAnswer } from "../tool/types.ts";
import { ROW_INTENT_META } from "./row-intent.ts";
import type { QuestionnaireRuntime, QuestionnaireState } from "./state.ts";

const KEYBIND_UP = "tui.select.up";
const KEYBIND_DOWN = "tui.select.down";
const KEYBIND_CONFIRM = "tui.select.confirm";
const KEYBIND_CANCEL = "tui.select.cancel";
/** TUI binding for "insert newline" (default `shift+enter`, `ctrl+j`). */
const KEYBIND_NEW_LINE = "tui.input.newLine";
const KEYBIND_EDITOR_UP = "tui.editor.cursorUp";
const KEYBIND_EDITOR_DOWN = "tui.editor.cursorDown";
/** TUI line-kill binding (default `ctrl+u`), reinterpreted as a whole-draft clear. */
const KEYBIND_INPUT_CLEAR = "tui.editor.deleteToLineStart";

/** Pi's built-in app-level binding for "open external editor" (default `ctrl+g`). Resolved via the app `KeybindingsManager` injected from the `ctx.ui.custom` factory, which also spreads the TUI bindings — so the same manager covers `tui.select.*`. */
const KEYBIND_EXTERNAL_EDITOR = "app.editor.external";

const NOTES_ACTIVATE_KEY = "n";
const SPACE_KEY = " ";

export type QuestionnaireAction =
  | { kind: "nav"; nextIndex: number }
  | { kind: "input_clear" }
  | { kind: "input_edit"; value: string }
  | { kind: "input_replace"; value: string }
  | { kind: "tab_switch"; nextTab: number }
  | { kind: "confirm"; answer: QuestionAnswer; autoAdvanceTab?: number }
  | { kind: "toggle"; index: number }
  | { kind: "multi_confirm"; selected: string[]; autoAdvanceTab?: number }
  | { kind: "cancel" }
  | { kind: "notes_enter" }
  | { kind: "notes_exit" }
  | { kind: "submit" }
  | { kind: "submit_nav"; nextIndex: 0 | 1 }
  | { kind: "notes_forward"; data: string }
  | { kind: "ignore" };

function wrapTab(index: number, total: number): number {
  if (total <= 0) return 0;
  return ((index % total) + total) % total;
}

function totalTabs(runtime: QuestionnaireRuntime): number {
  return runtime.isMulti ? runtime.questions.length + 1 : 1;
}

function computeAutoAdvanceTab(state: QuestionnaireState, runtime: QuestionnaireRuntime): number | undefined {
  if (!runtime.isMulti) return undefined;
  if (state.currentTab < runtime.questions.length - 1) return state.currentTab + 1;
  return runtime.questions.length;
}

function buildSingleSelectAnswer(state: QuestionnaireState, runtime: QuestionnaireRuntime): QuestionAnswer | null {
  const q = runtime.questions[state.currentTab];
  if (!q) return null;

  const item = runtime.currentItem;
  if (state.inputMode) {
    const label = runtime.inputBuffer;
    return {
      questionIndex: state.currentTab,
      question: q.question,
      kind: "custom",
      answer: label.length > 0 ? label : null,
    };
  }
  if (!item) return null;
  if (item.kind === "other") {
    return null;
  }
  if (item.kind === "next") {
    return null;
  }
  return {
    questionIndex: state.currentTab,
    question: q.question,
    kind: "option",
    answer: item.label,
  };
}

function buildMultiSelected(state: QuestionnaireState, runtime: QuestionnaireRuntime): string[] {
  const q = runtime.questions[state.currentTab];
  if (!q) return [];
  const out: string[] = [];
  for (let i = 0; i < q.options.length; i++) {
    if (state.multiSelectChecked.has(i)) {
      const label = q.options[i]?.label;
      if (typeof label === "string") out.push(label);
    }
  }
  return out;
}

function tabSwitchAction(
  data: string,
  state: QuestionnaireState,
  runtime: QuestionnaireRuntime,
): QuestionnaireAction | null {
  if (!runtime.isMulti) return null;
  const total = totalTabs(runtime);
  if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
    return {
      kind: "tab_switch",
      nextTab: wrapTab(state.currentTab + 1, total),
    };
  }
  if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
    return {
      kind: "tab_switch",
      nextTab: wrapTab(state.currentTab - 1, total),
    };
  }
  return null;
}

// DOWN wraps within the options list: last → first.
function nextNavOnDown(state: QuestionnaireState, runtime: QuestionnaireRuntime): QuestionnaireAction {
  return {
    kind: "nav",
    nextIndex: wrapTab(state.optionIndex + 1, Math.max(1, runtime.items.length)),
  };
}

// UP wraps within the options list: first → last.
function prevNavOnUp(state: QuestionnaireState, runtime: QuestionnaireRuntime): QuestionnaireAction {
  return {
    kind: "nav",
    nextIndex: wrapTab(state.optionIndex - 1, Math.max(1, runtime.items.length)),
  };
}

// Shared UP/DOWN row navigation used by both the input-mode tail and the default path.
function rowNavAction(
  data: string,
  kb: { matches(data: string, name: string): boolean },
  state: QuestionnaireState,
  runtime: QuestionnaireRuntime,
): QuestionnaireAction | undefined {
  if (kb.matches(data, KEYBIND_UP)) return prevNavOnUp(state, runtime);
  if (kb.matches(data, KEYBIND_DOWN)) return nextNavOnDown(state, runtime);
  return undefined;
}

// Shared confirm handling for single-select questions in both the input-mode tail and the default path.
function singleSelectConfirm(
  data: string,
  kb: { matches(data: string, name: string): boolean },
  state: QuestionnaireState,
  runtime: QuestionnaireRuntime,
): QuestionnaireAction | undefined {
  if (!kb.matches(data, KEYBIND_CONFIRM)) return undefined;
  const answer = buildSingleSelectAnswer(state, runtime);
  if (!answer) return { kind: "ignore" };
  return {
    kind: "confirm",
    answer,
    autoAdvanceTab: computeAutoAdvanceTab(state, runtime),
  };
}

export function routeKey(data: string, state: QuestionnaireState, runtime: QuestionnaireRuntime): QuestionnaireAction {
  const kb = runtime.keybindings;

  if (state.notesVisible) {
    if (kb.matches(data, KEYBIND_CANCEL)) return { kind: "notes_exit" };
    if (kb.matches(data, KEYBIND_CONFIRM)) return { kind: "notes_exit" };
    return { kind: "notes_forward", data };
  }

  // `n` opens the notes editor on every question tab. Hoisted above the
  // options / submit cascade so it cannot be swallowed by the Space/Enter
  // branches; gated only by inputMode (where `n` is a literal character typed
  // into the custom-answer field) and the submit tab (no per-question notes).
  if (
    data === NOTES_ACTIVATE_KEY &&
    !state.inputMode &&
    !(runtime.isMulti && state.currentTab === runtime.questions.length)
  ) {
    return { kind: "notes_enter" };
  }

  if (state.inputMode) {
    // Newline takes precedence over confirmation if a user configuration binds
    // the same physical key to both semantic actions.
    if (kb.matches(data, KEYBIND_NEW_LINE)) return { kind: "ignore" };
    const confirm = singleSelectConfirm(data, kb, state, runtime);
    if (confirm) return confirm;
    // Treat Pi's Ctrl+U line-kill binding as an explicit whole-draft clear,
    // independent of the current cursor position.
    if (kb.matches(data, KEYBIND_INPUT_CLEAR)) return { kind: "input_clear" };
    if (kb.matches(data, KEYBIND_EXTERNAL_EDITOR)) return { kind: "input_edit", value: runtime.inputBuffer };
    if (kb.matches(data, KEYBIND_CANCEL)) return { kind: "cancel" };
    // Vertical cursor movement stays inside the multi-line draft until the cursor
    // reaches its first/last logical line; only then do UP/DOWN leave for row nav.
    if (kb.matches(data, KEYBIND_EDITOR_UP) && runtime.canMoveInputUp) return { kind: "ignore" };
    if (kb.matches(data, KEYBIND_EDITOR_DOWN) && runtime.canMoveInputDown) return { kind: "ignore" };
    return rowNavAction(data, kb, state, runtime) ?? { kind: "ignore" };
  }

  if (runtime.isMulti && state.currentTab === runtime.questions.length) {
    if (kb.matches(data, KEYBIND_CANCEL)) return { kind: "cancel" };
    const tab = tabSwitchAction(data, state, runtime);
    if (tab) return tab;
    if (kb.matches(data, KEYBIND_UP) || kb.matches(data, KEYBIND_DOWN)) {
      const delta = kb.matches(data, KEYBIND_DOWN) ? 1 : -1;
      const next = wrapTab(state.submitChoiceIndex + delta, 2);
      return { kind: "submit_nav", nextIndex: (next === 1 ? 1 : 0) as 0 | 1 };
    }
    if (kb.matches(data, KEYBIND_CONFIRM)) {
      // D1 (revised): Submit always submits; Cancel always cancels. The warning header
      // is informational only — `allAnswered(state)` no longer gates submission. Partial
      // answers flow through `orderedAnswers()` in the host.
      return state.submitChoiceIndex === 1 ? { kind: "cancel" } : { kind: "submit" };
    }
    return { kind: "ignore" };
  }

  const tab = tabSwitchAction(data, state, runtime);
  if (tab) return tab;

  const q = runtime.questions[state.currentTab];
  if (!q) return { kind: "ignore" };

  const rowNav = rowNavAction(data, kb, state, runtime);
  if (rowNav) return rowNav;

  if (q.multiSelect) {
    const focusedKind = runtime.currentItem?.kind;
    const focusedMeta = focusedKind ? ROW_INTENT_META[focusedKind] : undefined;
    // Space toggles the focused row's checkbox. Suppressed on rows whose META declares
    // `blocksMultiToggle` (the Next sentinel) — Next is not a real option and has no
    // checked/unchecked state.
    if (data === SPACE_KEY) {
      if (focusedMeta?.blocksMultiToggle) return { kind: "ignore" };
      return { kind: "toggle", index: state.optionIndex };
    }
    if (kb.matches(data, KEYBIND_CONFIRM)) {
      // Enter on a regular row toggles (matching Space) — committing the question is now
      // gated behind explicit focus on a row whose META declares `autoSubmitsInMulti`
      // (the Next sentinel), so Enter on options is a no-cost way to flip checkboxes
      // without leaving the keyboard home row.
      if (!focusedMeta?.autoSubmitsInMulti) return { kind: "toggle", index: state.optionIndex };
      // Enter on Next: carry autoAdvanceTab so the host can advance to the next tab in
      // multi-question mode, OR submit the dialog in single-question mode
      // (autoAdvanceTab === undefined when !isMulti). Without this, a single multi-select
      // question would have no way to commit at all.
      return {
        kind: "multi_confirm",
        selected: buildMultiSelected(state, runtime),
        autoAdvanceTab: computeAutoAdvanceTab(state, runtime),
      };
    }
    if (kb.matches(data, KEYBIND_CANCEL)) return { kind: "cancel" };
    return { kind: "ignore" };
  }

  const confirm = singleSelectConfirm(data, kb, state, runtime);
  if (confirm) return confirm;
  if (kb.matches(data, KEYBIND_CANCEL)) return { kind: "cancel" };
  return { kind: "ignore" };
}
