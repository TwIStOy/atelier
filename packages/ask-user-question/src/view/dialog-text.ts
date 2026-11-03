import type { QuestionnaireState } from "../state/state.ts";

export const HINT_PART_ENTER = "Enter to select";
export const HINT_PART_NAV = "↑/↓ to navigate";
export const HINT_PART_TOGGLE = "Space to toggle";
export const HINT_PART_NOTES = "n to add notes";
export const HINT_PART_EDIT = "Ctrl+G to edit in external editor";
export const HINT_PART_TAB = "Tab to switch questions";
export const HINT_PART_CANCEL = "Esc to cancel";
export const HINT_PART_NEW_LINE = "Shift+Enter for newline";
export const HINT_PART_CLEAR = "Ctrl+U to clear";
export const REVIEW_HEADING = "Review your answers";
export const READY_PROMPT = "Ready to submit your answers?";
export const INCOMPLETE_WARNING_PREFIX = "⚠ Answer remaining questions before submitting:";

export type DialogState = QuestionnaireState;
