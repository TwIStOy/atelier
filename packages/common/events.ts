export const ZAI_CODING_PLAN_EVENTS = {
  USAGE_UPDATE: "pi-extensions:zai-coding-plan:usage-update",
  REQUEST_USAGE: "pi-extensions:zai-coding-plan:request-usage",
} as const;

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
