import type { ThemeColor } from "@earendil-works/pi-coding-agent";

/**
 * Cross-extension channel for editor-occupying modals.
 *
 * Any extension that takes over the editor slot via `ctx.ui.custom(...)`
 * (or otherwise presents a focused component that is not the default input
 * editor) SHOULD emit this event with `true` right before the modal mounts
 * and `false` once it has closed. Input-intercepting extensions such as
 * `message-queue` listen on this channel to suspend their Enter-key
 * swallowing while a modal owns focus — otherwise an empty-editor Enter
 * meant to drive the modal (e.g. selecting an option in `ask_user_question`)
 * would be misinterpreted as a queue flush.
 *
 * Payload: `boolean` — `true` when a modal becomes active, `false` when it
 * closes. Use try/finally so the `false` emission is guaranteed even on
 * exceptions or user dismissal.
 */
export const MODAL_ACTIVE_EVENT = "pi-extensions:ui:modal-active" as const;

/**
 * Cross-extension channel emitted by `ask_user_question` right before its
 * editor-occupying modal mounts, carrying the full question/option payload.
 *
 * Producers (currently `packages/ask-user-question`) emit via
 * `emitAskUserPrompt`. Consumers that want richer context than the bare
 * `MODAL_ACTIVE_EVENT` boolean — e.g. `moshi-hooks-extra` forwarding a
 * "needs input" notification with the actual question text — subscribe on
 * this channel to capture the questions, then react to `MODAL_ACTIVE_EVENT`
 * for the open/close edge.
 *
 * Payload: `AskUserPromptPayload` (structural — read-only consumer view).
 */
export const ASK_USER_PROMPT_EVENT = "ask_user_question:prompt" as const;

export type AskUserPromptOption = {
  label: string;
  description: string;
  hasPreview: boolean;
};

export type AskUserPromptQuestion = {
  question: string;
  header: string;
  multiSelect: boolean;
  options: ReadonlyArray<AskUserPromptOption>;
};

export type AskUserPromptPayload = {
  questions: ReadonlyArray<AskUserPromptQuestion>;
};

/**
 * Cross-extension channel emitted by `ask_user_question` to signal that the
 * agent is blocked waiting for the user to answer a questionnaire.
 *
 * Producers (currently `packages/ask-user-question`) emit `{ active: true }`
 * right before the editor-occupying modal mounts and `{ active: false }` once
 * it has closed — including cancel and UI-throw paths, guaranteed via the same
 * try/finally that brackets `ctx.ui.custom`. External state listeners (e.g.
 * `moshi-hooks-extra`) subscribe on this channel to flip a session status from
 * "working" to "blocked", distinct from the generic `MODAL_ACTIVE_EVENT`
 * boolean (which fires for any editor-occupying modal, not just
 * `ask_user_question`).
 *
 * Payload: `AskUserBlockedPayload` (`{ active: boolean }`).
 */
export const ASK_USER_BLOCKED_EVENT = "ask_user_question:blocked" as const;

export type AskUserBlockedPayload = {
  active: boolean;
};

/**
 * Cross-extension channel for transient hint messages rendered inside the
 * input editor's border (e.g. "esc again to abort").
 *
 * Producers (e.g. `experience/double-escape`) emit via `pi.events.emit` with a
 * payload describing the hint to show. The editor-owning extension (e.g.
 * `statusline`'s MyEditor) subscribes and renders the most recent active hint
 * into its own border, so the hint composes with whatever custom editor is
 * active instead of being clobbered by or clobbering the editor.
 *
 * Payload: `EditorHintPayload`. Emit with `text: null` (or `undefined` / empty
 * string) to clear the hint previously set for the given `source`.
 */
export const EDITOR_HINT_EVENT = "pi-extensions:ui:editor-hint" as const;

export type EditorHintPayload = {
  /** Stable id of the hint producer. Hints are tracked per-source; the most recently set non-empty hint is rendered. */
  source: string;
  /** Hint text to display, or null/undefined/empty to clear the hint for this source. */
  text: string | null | undefined;
  /** Optional theme color name for the hint text. Defaults to "warning". */
  color?: ThemeColor;
};
