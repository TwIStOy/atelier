import { Type } from "@sinclair/typebox";
import { runHat } from "../cli-runner.js";
import { jsonError, jsonResult } from "../tool-result.js";

export const journalRead = {
  name: "journal-read",
  label: "Journal read",
  description: "Read a specific journal entry by its timestamp ID.",
  parameters: Type.Object({
    id: Type.String({
      description: 'Timestamp ID of the entry (e.g., "20260310-143025-001").',
    }),
  }),
  execute: async (_id: string, args: Record<string, unknown>, signal?: AbortSignal) => {
    try {
      const result = await runHat(["journal", "read", args.id as string], { signal });
      if (!result) {
        return jsonResult({
          error: `Journal entry "${args.id}" not found.`,
        });
      }
      const content =
        result &&
        typeof result === "object" &&
        "content" in result &&
        typeof (result as { content?: string }).content === "string"
          ? (result as { content: string }).content
          : "";
      return jsonResult(result, {
        id: args.id,
        content_preview: content.slice(0, 200),
        content_lines: content ? content.split("\n").length : 0,
      });
    } catch (e) {
      return jsonError(e);
    }
  },
};
