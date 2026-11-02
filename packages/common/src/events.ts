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
 * `MODAL_ACTIVE_EVENT` boolean — for example a "needs input" notification
 * carrying the actual question text — subscribe on this channel to capture
 * the questions, then react to `MODAL_ACTIVE_EVENT` for the open/close edge.
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
 * Cross-extension channel emitted by `goal` whenever the session's goal
 * changes (created, status transitioned, usage accounted, cleared) — and once
 * on `session_start` when a goal is already stored, so consumers resuming a
 * session can sync their view without having observed the original changes.
 *
 * Producers (currently `packages/goal`) emit the full goal object, or `null`
 * when no goal exists. Consumers such as `ask_user_question` subscribe to
 * detect goal mode (an active goal means the agent runs autonomously with no
 * human present) and refuse to block on UI that nobody will answer.
 *
 * Payload: `GoalUpdatePayload` — structural, consumer-facing. Only `status`
 * (when non-null) is contractual; other goal fields are owned by `goal` and
 * may change without notice. The status literal union is written out by hand
 * to mirror `goal`'s `GoalStatus` — `common` must not import the goal package.
 */
export const GOAL_UPDATE_EVENT = "goal:update" as const;

export type GoalUpdatePayload = {
  /** Current goal status. The only contractual field of the payload. */
  status: "active" | "paused" | "budgetLimited" | "complete";
} | null;

/**
 * Cross-extension channel for transient hint messages rendered inside the
 * input editor's border (e.g. "esc again to abort").
 *
 * Producers emit via `pi.events.emit` with a
 * payload describing the hint to show. The editor-owning extension (e.g.
 * `better-editor`) subscribes and renders the most recent active hint
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
