import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { ASK_USER_BLOCKED_EVENT, MODAL_ACTIVE_EVENT } from "@htwang-contrib/common";
import { buildItemsForQuestion } from "./build-items.ts";
import { emitAskUserPrompt } from "./events.ts";
import { editWithExternalEditor } from "./state/external-editor.ts";
import { QuestionnaireSession } from "./state/questionnaire-session.ts";
import { buildQuestionnaireResponse, buildToolResult } from "./tool/response-envelope.ts";
import { runRpcQuestionnaire } from "./tool/rpc-native.ts";
import {
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MIN_OPTIONS,
  type QuestionnaireResult,
  type QuestionParams,
  QuestionParamsSchema,
} from "./tool/types.ts";
import { validateQuestionnaire } from "./tool/validate-questionnaire.ts";

const DEFAULT_PROMPT_SNIPPET = `Ask the user up to ${MAX_QUESTIONS} structured questions (${MIN_OPTIONS}-${MAX_OPTIONS} options each) when requirements are ambiguous`;

const DEFAULT_PROMPT_GUIDELINES: string[] = [
  `Use ask_user_question whenever the user's request is underspecified and you cannot proceed without concrete decisions — you can ask up to ${MAX_QUESTIONS} questions per invocation.`,
  `Each question MUST have ${MIN_OPTIONS}-${MAX_OPTIONS} options. Every option requires a concise label (1-5 words) and a description explaining what the choice means or its trade-offs. The user can additionally type a custom answer ("Type something." row is appended automatically to single-select questions) or press Esc to cancel and continue in free-form conversation.`,
  `Set multiSelect: true when multiple answers are valid; this suppresses the "Type something." row. Provide an options[].preview markdown string when an option benefits from richer side-by-side context (mockups, code snippets, diagrams, configs) — single-select only. NOTE: any non-empty preview on a single-select question ALSO suppresses the "Type something." row (no room in the side-by-side layout). If you recommend a specific option, make it the first option and append "(Recommended)" to its label.`,
  "Do not stack multiple ask_user_question calls back-to-back — group all clarifying questions into one invocation.",
];

export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";

const ERROR_NO_UI =
  "Error: ask_user_question has no interactive UI in this session. Ask the user your question directly in your reply instead of calling this tool.";

const TOOL_DESCRIPTION = `Ask the user one or more structured questions during execution. Use when you need to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take

Usage notes:
- Users will always be able to type a custom answer ("Type something." row is appended automatically to every single-select question) or press Esc to cancel and continue in free-form conversation. Do NOT author "Other" / "Type something." labels yourself — duplicates are rejected at runtime.
- Use multiSelect: true to allow multiple answers to be selected for a question. The "Type something." row is suppressed on multi-select questions, and is ALSO suppressed on single-select questions where any option carries a \`preview\` (the side-by-side layout has no room for inline custom text).
- If you recommend a specific option, make it the first option in the list and add "(Recommended)" at the end of the label.

Preview feature:
Use the optional \`preview\` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

Preview content is rendered as markdown in a monospace box. Multi-line text with newlines is supported. When any option has a preview, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported on single-select questions (not multiSelect).`;

export function registerAskUserQuestionTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: ASK_USER_QUESTION_TOOL_NAME,
    label: "Ask User Question",
    description: TOOL_DESCRIPTION,
    promptSnippet: DEFAULT_PROMPT_SNIPPET,
    promptGuidelines: DEFAULT_PROMPT_GUIDELINES,
    parameters: QuestionParamsSchema,
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const typed = params as QuestionParams;
      if (!ctx.hasUI) {
        return buildToolResult(ERROR_NO_UI, {
          answers: [],
          cancelled: true,
          error: "no_ui",
        });
      }

      const validation = validateQuestionnaire(typed);
      if (!validation.ok) {
        return buildToolResult(validation.message, {
          answers: [],
          cancelled: true,
          error: validation.error,
        });
      }

      emitAskUserPrompt(pi, typed);

      pi.events.emit(ASK_USER_BLOCKED_EVENT, { active: true });
      pi.events.emit(MODAL_ACTIVE_EVENT, true);
      try {
        const result =
          ctx.mode === "rpc" ? await runRpcQuestionnaire(ctx.ui, typed) : await runTuiQuestionnaire(ctx, typed);
        return buildQuestionnaireResponse(result, typed);
      } finally {
        pi.events.emit(MODAL_ACTIVE_EVENT, false);
        pi.events.emit(ASK_USER_BLOCKED_EVENT, { active: false });
      }
    },
  });
}

async function runTuiQuestionnaire(ctx: ExtensionContext, params: QuestionParams): Promise<QuestionnaireResult> {
  const itemsByTab = params.questions.map((q) => buildItemsForQuestion(q));
  return ctx.ui.custom<QuestionnaireResult>((tui, theme, keybindings, done) => {
    const session = new QuestionnaireSession({
      tui,
      theme,
      params,
      itemsByTab,
      keybindings,
      editInput: async (value) => {
        try {
          const editorCommand = SettingsManager.create(ctx.cwd, undefined, {
            projectTrusted: ctx.isProjectTrusted(),
          }).getExternalEditorCommand();
          return await editWithExternalEditor(tui, editorCommand, value);
        } catch (error) {
          // Launch failure, non-zero exit, or no editor configured: keep the
          // existing draft and let the user keep editing inline.
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`External editor failed: ${message}`, "error");
          return undefined;
        }
      },
      done,
    });
    return session.component;
  });
}
