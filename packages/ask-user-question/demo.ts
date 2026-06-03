import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { buildItemsForQuestion } from "./build-items.ts";
import { emitAskUserPrompt } from "./events.ts";
import { EXAMPLE_PHASE2_QUESTIONNAIRE } from "./example-phase2-questionnaire.ts";
import { EXAMPLE_QUESTIONNAIRE } from "./example-questionnaire.ts";
import { QuestionnaireSession } from "./state/questionnaire-session.ts";
import { buildQuestionnaireResponse } from "./tool/response-envelope.ts";
import type { QuestionnaireResult } from "./tool/types.ts";
import { validateQuestionnaire } from "./tool/validate-questionnaire.ts";

type Phase0ProbeResult = { probe: "auq_phase0"; dismissedBy: "enter" };

export function registerAskUserQuestionDemos(pi: ExtensionAPI): void {
  pi.registerCommand("auq-phase2", {
    description:
      "ask_user_question Phase 2 hand-test: multi-select + Submit, then single-select + Chat row (listen for ask_user_question:prompt)",
    async handler(_args, ctx: ExtensionCommandContext) {
      if (!ctx.hasUI) {
        ctx.ui.notify(
          "hasUI is false — Phase 2 demo skipped (expected in print/RPC)",
          "warning",
        );
        return;
      }
      const check = validateQuestionnaire(EXAMPLE_PHASE2_QUESTIONNAIRE);
      if (!check.ok) {
        ctx.ui.notify(check.message, "error");
        return;
      }
      emitAskUserPrompt(pi, EXAMPLE_PHASE2_QUESTIONNAIRE);
      const result = await ctx.ui.custom<QuestionnaireResult>(
        (tui, theme, _keybindings, done) => {
          const itemsByTab = EXAMPLE_PHASE2_QUESTIONNAIRE.questions.map((q) =>
            buildItemsForQuestion(q),
          );
          return new QuestionnaireSession({
            tui,
            theme,
            params: EXAMPLE_PHASE2_QUESTIONNAIRE,
            itemsByTab,
            done,
          }).component;
        },
      );
      const toolView = buildQuestionnaireResponse(
        result,
        EXAMPLE_PHASE2_QUESTIONNAIRE,
      );
      const text =
        toolView.content[0]?.type === "text" ? toolView.content[0].text : "";
      ctx.ui.notify(
        `Phase 2 demo done (cancelled=${result?.cancelled ?? true}). Envelope:\n${text}`,
        "info",
      );
    },
  });

  pi.registerCommand("auq-phase1", {
    description:
      "ask_user_question: open full QuestionnaireSession UI (sample 2 questions) in the editor slot",
    async handler(_args, ctx: ExtensionCommandContext) {
      if (!ctx.hasUI) {
        ctx.ui.notify(
          "hasUI is false — Phase 1 MVP demo skipped (expected in print/RPC)",
          "warning",
        );
        return;
      }
      const check = validateQuestionnaire(EXAMPLE_QUESTIONNAIRE);
      if (!check.ok) {
        ctx.ui.notify(check.message, "error");
        return;
      }
      const result = await ctx.ui.custom<QuestionnaireResult>(
        (tui, theme, _keybindings, done) => {
          const params = EXAMPLE_QUESTIONNAIRE;
          const itemsByTab = params.questions.map((q) =>
            buildItemsForQuestion(q),
          );
          return new QuestionnaireSession({
            tui,
            theme,
            params,
            itemsByTab,
            done,
          }).component;
        },
      );
      const toolView = buildQuestionnaireResponse(
        result,
        EXAMPLE_QUESTIONNAIRE,
      );
      const text =
        toolView.content[0]?.type === "text" ? toolView.content[0].text : "";
      ctx.ui.notify(
        `Phase 1 demo done (cancelled=${result?.cancelled ?? true}). Envelope:\n${text}`,
        "info",
      );
    },
  });

  pi.registerCommand("auq-phase0", {
    description:
      "ask_user_question port Phase 0: ctx.ui.custom in editor slot, Box+Text, Enter calls done()",
    async handler(_args, ctx: ExtensionCommandContext) {
      if (!ctx.hasUI) {
        ctx.ui.notify(
          "hasUI is false — Phase 0 UI probe skipped (expected in print/RPC)",
          "warning",
        );
        return;
      }
      const result = await ctx.ui.custom<Phase0ProbeResult>(
        (_tui, theme, _keybindings, done) => {
          const box = new Box(1, 1, (line) => theme.fg("dim", line));
          box.addChild(
            new Text(
              "ask_user_question Phase 0 UI probe (editor area — same mode as ghoseb/pi-askuserquestion)\nPress Enter to call done() and restore the prompt editor.",
            ),
          );
          const root: Component & { handleInput(data: string): void } = {
            render(width: number) {
              return box.render(width);
            },
            invalidate() {
              box.invalidate();
            },
            handleInput(data: string) {
              if (data === "\r" || data === "\n") {
                done({ probe: "auq_phase0", dismissedBy: "enter" });
              }
            },
          };
          return root;
        },
      );
      ctx.ui.notify(`Phase 0 probe ok: ${JSON.stringify(result)}`, "info");
    },
  });
}
