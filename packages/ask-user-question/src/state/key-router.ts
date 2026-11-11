import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { QuestionAnswer, QuestionData } from "../tool/types.ts";
import type { PointerTarget } from "./pointer-target.ts";
import { ROW_INTENT_META, type RowIntentMeta } from "./row-intent.ts";
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

type Keybindings = { matches(data: string, name: string): boolean };

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

function customDraftAnswer(state: QuestionnaireState, runtime: QuestionnaireRuntime, q: QuestionData): QuestionAnswer {
  const label = runtime.inputBuffer;
  return {
    questionIndex: state.currentTab,
    question: q.question,
    kind: "custom",
    answer: label.length > 0 ? label : null,
  };
}

function focusedOptionAnswer(
  state: QuestionnaireState,
  runtime: QuestionnaireRuntime,
  q: QuestionData,
): QuestionAnswer | null {
  const item = runtime.currentItem;
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

function buildSingleSelectAnswer(state: QuestionnaireState, runtime: QuestionnaireRuntime): QuestionAnswer | null {
  const q = runtime.questions[state.currentTab];
  if (!q) return null;

  if (state.inputMode) return customDraftAnswer(state, runtime, q);
  return focusedOptionAnswer(state, runtime, q);
}

function pushCheckedLabel(out: string[], option: QuestionData["options"][number] | undefined, checked: boolean): void {
  if (!checked) return;
  const label = option?.label;
  if (typeof label === "string") out.push(label);
}

function buildMultiSelected(state: QuestionnaireState, runtime: QuestionnaireRuntime): string[] {
  const q = runtime.questions[state.currentTab];
  if (!q) return [];
  const out: string[] = [];
  for (let i = 0; i < q.options.length; i++) {
    pushCheckedLabel(out, q.options[i], state.multiSelectChecked.has(i));
  }
  return out;
}

function backwardTabSwitch(data: string, state: QuestionnaireState, total: number): QuestionnaireAction | null {
  if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
    return {
      kind: "tab_switch",
      nextTab: wrapTab(state.currentTab - 1, total),
    };
  }
  return null;
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
  return backwardTabSwitch(data, state, total);
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
  kb: Keybindings,
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
  kb: Keybindings,
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

function routeNotesKeys(data: string, runtime: QuestionnaireRuntime): QuestionnaireAction {
  const kb = runtime.keybindings;
  if (kb.matches(data, KEYBIND_CANCEL)) return { kind: "notes_exit" };
  if (kb.matches(data, KEYBIND_CONFIRM)) return { kind: "notes_exit" };
  return { kind: "notes_forward", data };
}

function notesActivateBlocked(state: QuestionnaireState, runtime: QuestionnaireRuntime): boolean {
  return state.inputMode || (runtime.isMulti && state.currentTab === runtime.questions.length);
}

// `n` opens the notes editor on every question tab. Hoisted above the
// options / submit cascade so it cannot be swallowed by the Space/Enter
// branches; gated only by inputMode (where `n` is a literal character typed
// into the custom-answer field) and the submit tab (no per-question notes).
function routeNotesActivate(
  data: string,
  state: QuestionnaireState,
  runtime: QuestionnaireRuntime,
): QuestionnaireAction | undefined {
  if (data === NOTES_ACTIVATE_KEY && !notesActivateBlocked(state, runtime)) {
    return { kind: "notes_enter" };
  }
  return undefined;
}

function swallowEditorNavKey(kb: Keybindings, data: string, name: string, canMove: boolean): boolean {
  return kb.matches(data, name) && canMove;
}

// Vertical cursor movement stays inside the multi-line draft until the cursor
// reaches its first/last logical line; only then do UP/DOWN leave for row nav.
function routeInputModeNavKeys(
  data: string,
  kb: Keybindings,
  state: QuestionnaireState,
  runtime: QuestionnaireRuntime,
): QuestionnaireAction {
  if (swallowEditorNavKey(kb, data, KEYBIND_EDITOR_UP, runtime.canMoveInputUp)) return { kind: "ignore" };
  if (swallowEditorNavKey(kb, data, KEYBIND_EDITOR_DOWN, runtime.canMoveInputDown)) return { kind: "ignore" };
  return rowNavAction(data, kb, state, runtime) ?? { kind: "ignore" };
}

function routeInputModeTailKeys(
  data: string,
  state: QuestionnaireState,
  runtime: QuestionnaireRuntime,
): QuestionnaireAction {
  const kb = runtime.keybindings;
  if (kb.matches(data, KEYBIND_EXTERNAL_EDITOR)) return { kind: "input_edit", value: runtime.inputBuffer };
  if (kb.matches(data, KEYBIND_CANCEL)) return { kind: "cancel" };
  return routeInputModeNavKeys(data, kb, state, runtime);
}

function routeInputModeKeys(
  data: string,
  state: QuestionnaireState,
  runtime: QuestionnaireRuntime,
): QuestionnaireAction {
  const kb = runtime.keybindings;
  // Newline takes precedence over confirmation if a user configuration binds
  // the same physical key to both semantic actions.
  if (kb.matches(data, KEYBIND_NEW_LINE)) return { kind: "ignore" };
  const confirm = singleSelectConfirm(data, kb, state, runtime);
  if (confirm) return confirm;
  // Treat Pi's Ctrl+U line-kill binding as an explicit whole-draft clear,
  // independent of the current cursor position.
  if (kb.matches(data, KEYBIND_INPUT_CLEAR)) return { kind: "input_clear" };
  return routeInputModeTailKeys(data, state, runtime);
}

function isRowNavKey(kb: Keybindings, data: string): boolean {
  return kb.matches(data, KEYBIND_UP) || kb.matches(data, KEYBIND_DOWN);
}

function submitNavAction(data: string, kb: Keybindings, state: QuestionnaireState): QuestionnaireAction {
  const delta = kb.matches(data, KEYBIND_DOWN) ? 1 : -1;
  const next = wrapTab(state.submitChoiceIndex + delta, 2);
  return { kind: "submit_nav", nextIndex: (next === 1 ? 1 : 0) as 0 | 1 };
}

function routeSubmitChoiceKeys(
  data: string,
  state: QuestionnaireState,
  runtime: QuestionnaireRuntime,
): QuestionnaireAction {
  const kb = runtime.keybindings;
  if (isRowNavKey(kb, data)) return submitNavAction(data, kb, state);
  if (kb.matches(data, KEYBIND_CONFIRM)) {
    // D1 (revised): Submit always submits; Cancel always cancels. The warning header
    // is informational only — `allAnswered(state)` no longer gates submission. Partial
    // answers flow through `orderedAnswers()` in the host.
    return state.submitChoiceIndex === 1 ? { kind: "cancel" } : { kind: "submit" };
  }
  return { kind: "ignore" };
}

function routeSubmitTabKeys(
  data: string,
  state: QuestionnaireState,
  runtime: QuestionnaireRuntime,
): QuestionnaireAction {
  const kb = runtime.keybindings;
  if (kb.matches(data, KEYBIND_CANCEL)) return { kind: "cancel" };
  const tab = tabSwitchAction(data, state, runtime);
  if (tab) return tab;
  return routeSubmitChoiceKeys(data, state, runtime);
}

function focusedRowMeta(runtime: QuestionnaireRuntime): RowIntentMeta | undefined {
  const focusedKind = runtime.currentItem?.kind;
  return focusedKind ? ROW_INTENT_META[focusedKind] : undefined;
}

// Space toggles the focused row's checkbox. Suppressed on rows whose META declares
// `blocksMultiToggle` (the Next sentinel) — Next is not a real option and has no
// checked/unchecked state.
function spaceToggleAction(state: QuestionnaireState, focusedMeta: RowIntentMeta | undefined): QuestionnaireAction {
  if (focusedMeta?.blocksMultiToggle) return { kind: "ignore" };
  return { kind: "toggle", index: state.optionIndex };
}

function routeMultiConfirmKeys(
  data: string,
  state: QuestionnaireState,
  runtime: QuestionnaireRuntime,
  focusedMeta: RowIntentMeta | undefined,
): QuestionnaireAction {
  const kb = runtime.keybindings;
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

function routeMultiSelectKeys(
  data: string,
  state: QuestionnaireState,
  runtime: QuestionnaireRuntime,
): QuestionnaireAction {
  const focusedMeta = focusedRowMeta(runtime);
  if (data === SPACE_KEY) return spaceToggleAction(state, focusedMeta);
  return routeMultiConfirmKeys(data, state, runtime, focusedMeta);
}

function routeSingleSelectKeys(
  data: string,
  state: QuestionnaireState,
  runtime: QuestionnaireRuntime,
): QuestionnaireAction {
  const kb = runtime.keybindings;
  const confirm = singleSelectConfirm(data, kb, state, runtime);
  if (confirm) return confirm;
  if (kb.matches(data, KEYBIND_CANCEL)) return { kind: "cancel" };
  return { kind: "ignore" };
}

function routeQuestionKeys(
  q: QuestionData,
  data: string,
  state: QuestionnaireState,
  runtime: QuestionnaireRuntime,
): QuestionnaireAction {
  if (q.multiSelect) return routeMultiSelectKeys(data, state, runtime);
  return routeSingleSelectKeys(data, state, runtime);
}

function routeQuestionTabKeys(
  data: string,
  state: QuestionnaireState,
  runtime: QuestionnaireRuntime,
): QuestionnaireAction {
  const kb = runtime.keybindings;
  const tab = tabSwitchAction(data, state, runtime);
  if (tab) return tab;

  const q = runtime.questions[state.currentTab];
  if (!q) return { kind: "ignore" };

  const rowNav = rowNavAction(data, kb, state, runtime);
  if (rowNav) return rowNav;

  return routeQuestionKeys(q, data, state, runtime);
}

function routeTabKeys(data: string, state: QuestionnaireState, runtime: QuestionnaireRuntime): QuestionnaireAction {
  if (runtime.isMulti && state.currentTab === runtime.questions.length) {
    return routeSubmitTabKeys(data, state, runtime);
  }
  return routeQuestionTabKeys(data, state, runtime);
}

function routeDialogKeys(data: string, state: QuestionnaireState, runtime: QuestionnaireRuntime): QuestionnaireAction {
  const notesEnter = routeNotesActivate(data, state, runtime);
  if (notesEnter) return notesEnter;
  if (state.inputMode) return routeInputModeKeys(data, state, runtime);
  return routeTabKeys(data, state, runtime);
}

export function routeKey(data: string, state: QuestionnaireState, runtime: QuestionnaireRuntime): QuestionnaireAction {
  if (state.notesVisible) return routeNotesKeys(data, runtime);
  return routeDialogKeys(data, state, runtime);
}

// Absolute tab target — a click names the tab, so no wrap arithmetic is needed on the
// pointer path (unlike the relative Tab/Shift+Tab keys).
function pointerTabAction(
  target: PointerTarget,
  state: QuestionnaireState,
  runtime: QuestionnaireRuntime,
): QuestionnaireAction[] {
  if (!runtime.isMulti) return [];
  const total = totalTabs(runtime);
  if (target.kind === "submit_tab") return [{ kind: "tab_switch", nextTab: runtime.questions.length }];
  if (target.index < 0 || target.index >= total) return [];
  if (target.index === state.currentTab) return [];
  return [{ kind: "tab_switch", nextTab: target.index }];
}

/**
 * Click on an option row: focus it first, then apply the mode's action, mirroring what
 * the keyboard does (Enter on a single-select commits, Enter/Space on a multi-select
 * toggles, Enter on Next commits the question).
 *
 * Two actions — not one — because the reducer reads the focused row from state
 * (`runtime.currentItem`) when building answers, so focus must be committed first.
 * The `other` sentinel only focuses: its commit path is typing into the inline input.
 */
function pointerOptionActions(
  index: number,
  state: QuestionnaireState,
  runtime: QuestionnaireRuntime,
): QuestionnaireAction[] {
  const question = runtime.questions[state.currentTab];
  const item = runtime.items[index];
  if (!question || !item) return [];
  const focus: QuestionnaireAction = { kind: "nav", nextIndex: index };
  const meta = ROW_INTENT_META[item.kind];
  if (meta.activatesInputMode) return [focus];

  if (question.multiSelect) {
    if (meta.autoSubmitsInMulti) {
      return [
        focus,
        {
          kind: "multi_confirm",
          selected: buildMultiSelected(state, runtime),
          autoAdvanceTab: computeAutoAdvanceTab(state, runtime),
        },
      ];
    }
    return [focus, { kind: "toggle", index }];
  }

  if (item.kind !== "option") return [focus];
  return [
    focus,
    {
      kind: "confirm",
      answer: {
        questionIndex: state.currentTab,
        question: question.question,
        kind: "option",
        answer: item.label,
      },
      autoAdvanceTab: computeAutoAdvanceTab(state, runtime),
    },
  ];
}

/**
 * Reducer actions for a click, in commit order. Empty when the click has no effect
 * (stale row, the already-active tab, or a dialog owned by the notes editor).
 */
export function routePointer(
  target: PointerTarget,
  state: QuestionnaireState,
  runtime: QuestionnaireRuntime,
): QuestionnaireAction[] {
  if (state.notesVisible) return [];
  switch (target.kind) {
    case "tab":
    case "submit_tab":
      return pointerTabAction(target, state, runtime);
    case "option":
      return pointerOptionActions(target.index, state, runtime);
    case "submit_choice":
      return [target.index === 1 ? { kind: "cancel" } : { kind: "submit" }];
  }
}
