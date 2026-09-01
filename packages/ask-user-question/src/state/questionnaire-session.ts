import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Editor, Input } from "@earendil-works/pi-tui";
import type { QuestionData, QuestionnaireResult, QuestionParams } from "../tool/types.ts";
import type { WrappingSelectItem } from "../view/components/wrapping-select.ts";
import type { QuestionnairePropsAdapter } from "../view/props-adapter.ts";
import { buildQuestionnaire } from "./build-questionnaire.ts";
import { type QuestionnaireAction, routeKey } from "./key-router.ts";
import type { QuestionnaireRuntime, QuestionnaireState } from "./state.ts";
import { type ApplyContext, type Effect, reduce } from "./state-reducer.ts";

export interface QuestionnaireSessionConfig {
  tui: { terminal: { columns: number; rows: number }; requestRender(): void };
  theme: Theme;
  params: QuestionParams;
  itemsByTab: WrappingSelectItem[][];
  /** App-level `KeybindingsManager` injected from the `ctx.ui.custom` factory. Resolves both `tui.select.*` and `app.editor.external` (the factory-provided manager spreads the TUI bindings). */
  keybindings: { matches(data: string, name: string): boolean };
  /** Open Pi's configured external editor on `value`; resolve the edited text, or `undefined` to keep the draft (e.g. launch failure). Owned by the host so this class stays free of `SettingsManager`/TUI-lifecycle coupling. */
  editInput: (value: string) => Promise<string | undefined>;
  done: (result: QuestionnaireResult) => void;
}

export interface QuestionnaireSessionComponent {
  render(width: number): string[];
  invalidate(): void;
  handleInput(data: string): void;
}

function initialState(): QuestionnaireState {
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
  };
}

/**
 * Slim runtime: owns the canonical state cell, the input-buffer cell, the
 * two-pass `notesVisible` dispatch loop, and the effect runner. State
 * transitions go through the pure `reduce` reducer; UI fan-out goes through
 * the `QuestionnairePropsAdapter` produced by `buildQuestionnaire`.
 */
export class QuestionnaireSession {
  private state: QuestionnaireState = initialState();

  private readonly questions: readonly QuestionData[];
  private readonly isMulti: boolean;
  private readonly itemsByTab: WrappingSelectItem[][];

  private readonly notesInput: Input;
  private readonly inlineEditor: Editor;
  private readonly viewAdapter: QuestionnairePropsAdapter;

  private readonly keybindings: QuestionnaireSessionConfig["keybindings"];
  private readonly editInput: QuestionnaireSessionConfig["editInput"];
  /** Reentry guard: while the external editor owns the terminal, all dispatch is a no-op. */
  private inputEditorOpen = false;

  private readonly tui: QuestionnaireSessionConfig["tui"];
  private readonly done: QuestionnaireSessionConfig["done"];

  readonly component: QuestionnaireSessionComponent;

  constructor(config: QuestionnaireSessionConfig) {
    this.tui = config.tui;
    this.done = config.done;
    this.keybindings = config.keybindings;
    this.editInput = config.editInput;
    this.questions = config.params.questions;
    this.isMulti = this.questions.length > 1;
    this.itemsByTab = config.itemsByTab;

    const built = buildQuestionnaire({
      tui: this.tui,
      theme: config.theme,
      questions: this.questions,
      itemsByTab: this.itemsByTab,
      isMulti: this.isMulti,
      initialState: this.state,
      getCurrentTab: () => this.state.currentTab,
    });

    this.notesInput = built.notesInput;
    this.inlineEditor = built.inlineEditor;
    this.viewAdapter = built.adapter;

    this.component = {
      render: (width) => built.render(width),
      invalidate: built.invalidate,
      handleInput: (data) => this.dispatch(data),
    };

    this.viewAdapter.apply(this.state);
  }

  dispatch(data: string): void {
    if (this.inputEditorOpen) return;
    const action = routeKey(data, this.state, this.runtime());
    if (action.kind === "ignore") {
      this.handleIgnoreInline(data);
      return;
    }
    this.commit(action);
  }

  private commit(action: QuestionnaireAction): void {
    const result = reduce(this.state, action, this.applyContext());
    this.state = result.state;
    for (const effect of result.effects) this.runEffect(effect);
    this.state = this.mirrorNotesDraft(this.state);
    this.viewAdapter.apply(this.state);
  }

  private mirrorNotesDraft(s: QuestionnaireState): QuestionnaireState {
    const draft = this.notesInput.getValue();
    return s.notesDraft === draft ? s : { ...s, notesDraft: draft };
  }

  private runEffect(effect: Effect): void {
    switch (effect.kind) {
      case "set_input_buffer":
        // `setText` places the cursor at the end of the (last line of the) text.
        this.inlineEditor.setText(effect.value);
        return;
      case "clear_input_buffer":
        this.inlineEditor.setText("");
        return;
      case "open_input_editor":
        if (this.inputEditorOpen) return;
        this.inputEditorOpen = true;
        void this.editInput(effect.value).then(
          (value) => {
            this.inputEditorOpen = false;
            // `undefined` means the host reported a launch failure (or the user made no
            // editable change worth committing) — retain the existing draft and resume.
            if (value !== undefined) this.commit({ kind: "input_replace", value });
          },
          () => {
            this.inputEditorOpen = false;
          },
        );
        return;
      case "set_notes_value":
        this.notesInput.setValue(effect.value);
        return;
      case "set_notes_focused":
        this.notesInput.focused = effect.focused;
        return;
      case "forward_notes_keystroke":
        this.notesInput.handleInput(effect.data);
        return;
      case "done":
        this.done(effect.result);
        return;
    }
  }

  /**
   * Per-keystroke `ignore` fast path: delegates to the headless `inlineEditor`
   * so its own bracketed-paste accumulator, Kitty CSI-u decode, newline
   * insertion, undo, and cursor movement take effect. No cursor force-reset — the
   * editor owns the cursor; `WrappingSelect.renderInlineInputRow` mirrors it per
   * tick via the props adapter. `viewAdapter.apply` runs directly, skipping the
   * reducer so per-keystroke edits never pay a state-dispatch round-trip.
   */
  private handleIgnoreInline(data: string): void {
    if (!this.state.inputMode) return;
    this.inlineEditor.handleInput(data);
    this.viewAdapter.apply(this.state);
  }

  private runtime(): QuestionnaireRuntime {
    const cursor = this.inlineEditor.getCursor();
    const lastLine = this.inlineEditor.getLines().length - 1;
    return {
      keybindings: this.keybindings,
      inputBuffer: this.inlineEditor.getExpandedText(),
      canMoveInputUp: cursor.line > 0,
      canMoveInputDown: cursor.line < lastLine,
      questions: this.questions,
      isMulti: this.isMulti,
      currentItem: this.currentItem(),
      items: this.itemsByTab[this.state.currentTab] ?? [],
    };
  }

  private applyContext(): ApplyContext {
    return {
      questions: this.questions,
      itemsByTab: this.itemsByTab,
      // Expanded form: persisted drafts and answers carry real paste content, never
      // the `[paste #N …]` marker the editor stores in its lines.
      inputBuffer: this.inlineEditor.getExpandedText(),
    };
  }

  private currentItem(): WrappingSelectItem | undefined {
    const arr = this.itemsByTab[this.state.currentTab] ?? [];
    return arr[this.state.optionIndex];
  }
}
