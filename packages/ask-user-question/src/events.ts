import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ASK_USER_PROMPT_EVENT, type AskUserPromptPayload } from "@htwang-contrib/common";
import type { QuestionParams } from "./tool/types.ts";

export { ASK_USER_PROMPT_EVENT };
export type {
  AskUserPromptOption,
  AskUserPromptPayload,
  AskUserPromptQuestion,
} from "@htwang-contrib/common";

export function buildAskUserPromptPayload(params: QuestionParams): AskUserPromptPayload {
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

export function emitAskUserPrompt(pi: ExtensionAPI, params: QuestionParams): void {
  pi.events.emit(ASK_USER_PROMPT_EVENT, buildAskUserPromptPayload(params));
}
