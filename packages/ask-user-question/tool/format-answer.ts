import type { QuestionAnswer } from "./types.ts";

export const CHAT_CONTINUATION_MESSAGE =
  "User wants to chat about this. Continue the conversation to help them decide.";

export const CHAT_SUMMARY_MESSAGE = "User wants to chat about this";

export const NO_INPUT_PLACEHOLDER = "(no input)";

export type FormatAnswerVariant = "summary" | "envelope";

export function formatAnswerScalar(
  a: QuestionAnswer,
  variant: FormatAnswerVariant,
): string {
  switch (a.kind) {
    case "chat":
      return variant === "envelope"
        ? CHAT_CONTINUATION_MESSAGE
        : CHAT_SUMMARY_MESSAGE;
    case "multi":
      return a.selected && a.selected.length > 0
        ? a.selected.join(", ")
        : NO_INPUT_PLACEHOLDER;
    case "custom":
      return a.answer && a.answer.length > 0 ? a.answer : NO_INPUT_PLACEHOLDER;
    case "option":
      return a.answer ?? NO_INPUT_PLACEHOLDER;
  }
}
