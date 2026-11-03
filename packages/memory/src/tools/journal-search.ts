import { Type } from "@sinclair/typebox";
import { runHat } from "../cli-runner.js";
import { jsonError, jsonResult } from "../tool-result.js";
import { pushCsv, pushDefined } from "./cli-args.js";
import { parseListResult } from "./parse-list.js";

export const journalSearch = {
  name: "journal-search",
  label: "Journal search",
  annotations: { readOnlyHint: true },
  description: "Search journal entries by text content or tags with pagination. Returns summaries sorted by recency.",
  parameters: Type.Object({
    text: Type.Optional(
      Type.String({
        description: "Substring to search for in title and body.",
      }),
    ),
    tags: Type.Optional(
      Type.Array(Type.String(), {
        description: "Filter by tags (entries matching ANY tag are included).",
      }),
    ),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum entries to return (default: 20).",
      }),
    ),
    offset: Type.Optional(
      Type.Number({
        description: "Number of entries to skip for pagination (default: 0).",
      }),
    ),
  }),
  execute: async (_id: string, args: Record<string, unknown>, signal?: AbortSignal) => {
    try {
      const result = await runHat(buildJournalSearchArgs(args), { signal });
      const items = parseListResult(result, "results").map(journalSearchItem);
      return jsonResult(result, {
        query: args.text ?? args.tags ?? "",
        total: items.length,
        items,
      });
    } catch (e) {
      return jsonError(e);
    }
  },
};

function buildJournalSearchArgs(args: Record<string, unknown>): string[] {
  const cliArgs = ["journal", "search"];
  if (args.text) cliArgs.push("--text", args.text as string);
  pushCsv(cliArgs, "--tags", args.tags);
  pushDefined(cliArgs, "--limit", args.limit);
  pushDefined(cliArgs, "--offset", args.offset);
  return cliArgs;
}

function journalSearchItem(e: Record<string, unknown>): { id: string; title: string } {
  return {
    id: String(e.id ?? e.timestamp ?? ""),
    title: String(e.title ?? ""),
  };
}
