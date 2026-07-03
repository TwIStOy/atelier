import { Type } from "@sinclair/typebox";
import { runHat } from "../cli-runner.js";
import { jsonError, jsonResult } from "../tool-result.js";

function parseListResult(result: unknown): Record<string, unknown>[] {
  if (!result || typeof result !== "object") return [];
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.results)) return r.results as Record<string, unknown>[];
  if (Array.isArray(r.data)) return r.data as Record<string, unknown>[];
  return [];
}

export const journalSearch = {
  name: "journal-search",
  label: "Journal search",
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
      const cliArgs = ["journal", "search"];
      if (args.text) cliArgs.push("--text", args.text as string);
      if ((args.tags as string[])?.length) cliArgs.push("--tags", (args.tags as string[]).join(","));
      if (args.limit !== undefined) cliArgs.push("--limit", String(args.limit));
      if (args.offset !== undefined) cliArgs.push("--offset", String(args.offset));
      const result = await runHat(cliArgs, { signal });
      const items = parseListResult(result).map((e: Record<string, unknown>) => ({
        id: String(e.id ?? e.timestamp ?? ""),
        title: String(e.title ?? ""),
      }));
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
