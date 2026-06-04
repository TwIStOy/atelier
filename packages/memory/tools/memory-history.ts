import { Type } from "@sinclair/typebox";
import { runHat } from "../cli-runner.js";
import { jsonError, jsonResult } from "../tool-result.js";

function parseListResult(result: unknown): Record<string, unknown>[] {
  if (!result || typeof result !== "object") return [];
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.versions)) return r.versions as Record<string, unknown>[];
  if (Array.isArray(r.data)) return r.data as Record<string, unknown>[];
  return [];
}

export const memoryHistory = {
  name: "memory-history",
  label: "Memory history",
  description:
    "View version history for a specific memory node. Returns snapshots of past content with timestamps and action types.",
  parameters: Type.Object({
    uri: Type.String({
      description:
        "Node URI in domain://path format (e.g. 'core://agent/identity').",
    }),
    limit: Type.Optional(
      Type.Number({ description: "Max entries to return (default 10)." }),
    ),
  }),
  execute: async (_id: string, args: Record<string, unknown>) => {
    try {
      const cliArgs = ["memory", "versions", args.uri as string];
      if (args.limit !== undefined) cliArgs.push("--limit", String(args.limit));
      const result = await runHat(cliArgs);
      const items = parseListResult(result).map(
        (v: Record<string, unknown>) => {
          const action = v.action ?? v.type ?? "?";
          const ts = v.timestamp ?? v.id ?? v.created_at ?? "";
          return `${action} ${ts}`;
        },
      );
      return jsonResult(result, {
        uri: args.uri,
        total: items.length,
        versions: items,
      });
    } catch (e) {
      return jsonError(e);
    }
  },
};
