import type { QuestionParams } from "./tool/types.ts";

export const EXAMPLE_QUESTIONNAIRE: QuestionParams = {
  questions: [
    {
      question:
        "Which persistence style should we use for local session draft state?",
      header: "Storage",
      options: [
        {
          label: "SQLite file",
          description:
            "Embedded DB under the agent dir; structured queries and migrations.",
        },
        {
          label: "JSON append-only",
          description:
            "Plain files per session; trivial to inspect and copy out.",
        },
        {
          label: "Redis sidecar",
          description:
            "Shared in-memory store; needs a reachable Redis endpoint.",
        },
      ],
    },
    {
      question: "How aggressive should compaction summaries be by default?",
      header: "Compaction",
      options: [
        {
          label: "Conservative",
          description: "Keep more verbatim context; larger sessions on disk.",
        },
        {
          label: "Balanced",
          description: "Default trade-off between size and recall.",
        },
      ],
    },
  ],
};
