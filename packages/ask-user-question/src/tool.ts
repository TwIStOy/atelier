import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { GOAL_UPDATE_EVENT, type GoalUpdatePayload, MODAL_ACTIVE_EVENT } from "@htwang-contrib/common";
import { buildItemsForQuestion } from "./build-items.ts";
import { emitAskUserPrompt } from "./events.ts";
import { editWithExternalEditor } from "./state/external-editor.ts";
import { QuestionnaireSession } from "./state/questionnaire-session.ts";
import { buildQuestionnaireResponse, buildToolResult } from "./tool/response-envelope.ts";
import { runRpcQuestionnaire } from "./tool/rpc-native.ts";
import { sanitizeQuestionnaire } from "./tool/sanitize-questionnaire.ts";
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
  "Do not stack multiple ask_user_question calls back-to-back — group all clarifying questions into one invocation.",
];

export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";

// True while a goal with status "active" exists: the agent runs autonomously
// (AFK) and no human is present to answer a modal. Synced from GOAL_UPDATE_EVENT;
// a fresh registration has seen no goal event yet, and goal re-emits on every
// session_start, so resetting here keeps the flag from leaking across reloads.
let activeGoal = false;

function trackGoalMode(pi: ExtensionAPI): void {
  activeGoal = false;
  pi.events.on(GOAL_UPDATE_EVENT, (data: unknown) => {
    const goal = data as GoalUpdatePayload;
    activeGoal = goal?.status === "active";
  });
}

const ERROR_NO_UI =
  "Error: ask_user_question has no interactive UI in this session. Ask the user your question directly in your reply instead of calling this tool.";

const ERROR_GOAL_MODE =
  "ask_user_question is unavailable in goal mode: a goal is active, you are running autonomously, and no user is present to answer. Do not retry this tool and do not wait for human input. Make a reasonable default decision yourself and continue. If the decision genuinely requires human judgment, stop and report instead, or pause the goal first (/goal pause) and continue with work that does not need the answer.";

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
  trackGoalMode(pi);
  pi.registerTool({
    name: ASK_USER_QUESTION_TOOL_NAME,
    label: "Ask User Question",
    description: TOOL_DESCRIPTION,
    promptSnippet: DEFAULT_PROMPT_SNIPPET,
    promptGuidelines: DEFAULT_PROMPT_GUIDELINES,
    parameters: QuestionParamsSchema,
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    annotations: { readOnlyHint: true },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const typed = sanitizeQuestionnaire(params as QuestionParams);
      if (!ctx.hasUI) {
        return buildToolResult(ERROR_NO_UI, {
          answers: [],
          cancelled: true,
          error: "no_ui",
        });
      }

      if (activeGoal) {
        return buildToolResult(ERROR_GOAL_MODE, {
          answers: [],
          cancelled: true,
          error: "goal_mode",
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

      pi.events.emit(MODAL_ACTIVE_EVENT, true);
      try {
        const result =
          ctx.mode === "rpc" ? await runRpcQuestionnaire(ctx.ui, typed) : await runTuiQuestionnaire(ctx, typed);
        return buildQuestionnaireResponse(result, typed);
      } finally {
        pi.events.emit(MODAL_ACTIVE_EVENT, false);
      }
    },
  });
}

async function runTuiQuestionnaire(ctx: ExtensionContext, params: QuestionParams): Promise<QuestionnaireResult> {
  const itemsByTab = params.questions.map((q) => buildItemsForQuestion(q));
  return ctx.ui.custom<QuestionnaireResult>(
    (tui, theme, keybindings, done) => {
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
    },
    {
      blocked: {
        kind: "question",
        message:
          params.questions.length === 1 ? params.questions[0].header : `Answer ${params.questions.length} questions`,
      },
    },
  );
}
