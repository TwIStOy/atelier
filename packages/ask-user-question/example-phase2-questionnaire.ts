import type { QuestionParams } from "./tool/types.ts";

export const EXAMPLE_PHASE2_QUESTIONNAIRE: QuestionParams = {
  questions: [
    {
      header: "Scopes",
      question:
        "Which Phase 2 tracks should we implement next? (Space toggles, Enter on Submit confirms.)",
      multiSelect: true,
      options: [
        {
          label: "state/ + reducer",
          description:
            "Pure reduce + Effect queue parity with rpiv (QuestionnaireAction exhaustiveness).",
        },
        {
          label: "view/ + Markdown preview",
          description:
            "PreviewPane, getMarkdownTheme, side-by-side vs stacked layout.",
        },
        {
          label: "tool-display adapter",
          description: "Optional folded tool row for ask_user_question.",
        },
      ],
    },
    {
      header: "Escape",
      question:
        "Second step: pick an option or move to “Chat about this” to test the sentinel row.",
      options: [
        {
          label: "Continue with a normal pick",
          description: "Answer this question with a structured option.",
        },
        {
          label: "Pick the other option",
          description: "Alternate row so ↑↓ has somewhere to go before Chat.",
        },
      ],
    },
  ],
};
