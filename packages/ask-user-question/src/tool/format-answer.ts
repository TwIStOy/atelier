import type { QuestionAnswer } from "./types.ts";

/**
 * Placeholder for empty / null answer text. Used uniformly — the earlier `(no answer)`
 * fallback in the dialog summary was accidental drift; tests pin `(no input)` only.
 */
const NO_INPUT_PLACEHOLDER = "(no input)";

/**
 * Format a `QuestionAnswer` to its scalar string form. Switch is exhaustive — non-`void`
 * return enforces every variant is handled.
 */
export function formatAnswerScalar(a: QuestionAnswer): string {
  switch (a.kind) {
    case "multi":
      return a.selected && a.selected.length > 0 ? a.selected.join(", ") : NO_INPUT_PLACEHOLDER;
    case "custom":
      return a.answer && a.answer.length > 0 ? a.answer : NO_INPUT_PLACEHOLDER;
    case "option":
      return a.answer ?? NO_INPUT_PLACEHOLDER;
  }
}
