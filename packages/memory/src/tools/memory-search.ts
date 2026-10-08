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

export const memorySearch = {
  name: "memory-search",
  label: "Memory search",
  annotations: { readOnlyHint: true },
  description:
    "Ranked search across all memory nodes — use PROACTIVELY before answering anything that may depend on past context (past work, preferences, decisions, project conventions). Tokenizes query, scores matches across URI, content, tags, and disclosure fields, returns results sorted by relevance with snippets. For multi-part or comparative questions, run several searches with different phrasings and combine the results — one search is rarely enough.",
  parameters: Type.Object({
    query: Type.String({
      description: "Search keywords (tokenized, multi-term supported).",
    }),
    limit: Type.Optional(Type.Number({ description: "Max results (default 10)." })),
  }),
  execute: async (_id: string, args: Record<string, unknown>, signal?: AbortSignal) => {
    try {
      const cliArgs = ["memory", "search", args.query as string];
      if (args.limit !== undefined) cliArgs.push("--limit", String(args.limit));
      const result = await runHat(cliArgs, { signal });
      const items = parseListResult(result).map((r: Record<string, unknown>) => ({
        uri: r.uri ?? r.path ?? "",
        snippet: String(r.snippet ?? r.content ?? "")
          .split(/\r?\n/)[0]
          ?.slice(0, 120),
      }));
      return jsonResult(result, {
        query: args.query,
        total: items.length,
        items,
      });
    } catch (e) {
      return jsonError(e);
    }
  },
};
