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
