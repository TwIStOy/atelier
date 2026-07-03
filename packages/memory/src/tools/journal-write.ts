import { Type } from "@sinclair/typebox";
import { runHat } from "../cli-runner.js";
import { jsonError, jsonResult } from "../tool-result.js";

export const journalWrite = (getCwd: () => string) => ({
  name: "journal-write",
  label: "Journal write",
  description:
    "Write a new journal entry (append-only). Journal entries are permanent records of discoveries, decisions, and insights.",
  parameters: Type.Object({
    title: Type.String({
      description: "Short title summarizing the entry.",
    }),
    body: Type.String({
      description: "Full content of the journal entry.",
    }),
    tags: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Tags for categorization (e.g., ["debugging", "networking"]).',
      }),
    ),
  }),
  execute: async (_id: string, args: Record<string, unknown>, signal?: AbortSignal) => {
    try {
      const cliArgs = [
        "journal",
        "write",
        "--title",
        args.title as string,
        "--body",
        args.body as string,
        "--project",
        getCwd(),
      ];
      if ((args.tags as string[])?.length) cliArgs.push("--tags", (args.tags as string[]).join(","));
      const result = await runHat(cliArgs, { signal });
      return jsonResult(result, { title: args.title });
    } catch (e) {
      return jsonError(e);
    }
  },
});
