import { Type } from "@sinclair/typebox";
import { runHat } from "../cli-runner.js";
import { jsonError, jsonResult } from "../tool-result.js";
import { pushDefined } from "./cli-args.js";
import { parseListResult } from "./parse-list.js";

export const memoryHistory = {
  name: "memory-history",
  label: "Memory history",
  annotations: { readOnlyHint: true },
  description:
    "View version history for a specific memory node. Returns snapshots of past content with timestamps and action types.",
  parameters: Type.Object({
    uri: Type.String({
      description: "Node URI in domain://path format (e.g. 'core://agent/identity').",
    }),
    limit: Type.Optional(Type.Number({ description: "Max entries to return (default 10)." })),
  }),
  execute: async (_id: string, args: Record<string, unknown>, signal?: AbortSignal) => {
    try {
      const cliArgs = ["memory", "versions", args.uri as string];
      pushDefined(cliArgs, "--limit", args.limit);
      const result = await runHat(cliArgs, { signal });
      const items = parseListResult(result, "versions").map(historyItem);
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

function historyAction(v: Record<string, unknown>): unknown {
  return v.action ?? v.type ?? "?";
}

function historyTimestamp(v: Record<string, unknown>): unknown {
  return v.timestamp ?? v.id ?? v.created_at ?? "";
}

function historyItem(v: Record<string, unknown>): string {
  return `${historyAction(v)} ${historyTimestamp(v)}`;
}
