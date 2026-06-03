import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { QuestionParams } from "./tool/types.ts";

export const ASK_USER_PROMPT_EVENT = "ask_user_question:prompt" as const;

export type AskUserPromptQuestionSummary = {
  header: string;
  question: string;
  multiSelect: boolean;
  hasPreview: boolean;
};

export type AskUserPromptPayload = {
  questions: AskUserPromptQuestionSummary[];
};

export function buildAskUserPromptPayload(
  params: QuestionParams,
): AskUserPromptPayload {
  return {
    questions: params.questions.map((q) => ({
      header: q.header,
      question: q.question,
      multiSelect: q.multiSelect === true,
      hasPreview: q.options.some(
        (o) => typeof o.preview === "string" && o.preview.trim().length > 0,
      ),
    })),
  };
}

export function emitAskUserPrompt(
  pi: ExtensionAPI,
  params: QuestionParams,
): void {
  pi.events.emit(ASK_USER_PROMPT_EVENT, buildAskUserPromptPayload(params));
}
