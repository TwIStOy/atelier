import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { QuestionParams } from "./tool/types.ts";

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

export function buildAskUserPromptPayload(
  params: QuestionParams,
): AskUserPromptPayload {
  return {
    questions: params.questions.map((q) => ({
      question: q.question,
      header: q.header,
      multiSelect: q.multiSelect ?? false,
      options: q.options.map((o) => ({
        label: o.label,
        description: o.description,
        hasPreview: typeof o.preview === "string" && o.preview.length > 0,
      })),
    })),
  };
}

export function emitAskUserPrompt(
  pi: ExtensionAPI,
  params: QuestionParams,
): void {
  pi.events.emit(ASK_USER_PROMPT_EVENT, buildAskUserPromptPayload(params));
}
