import { Type } from "@sinclair/typebox";
import { type Change, diffLines } from "diff";
import { runHat } from "../cli-runner.js";
import { jsonError, jsonResult } from "../tool-result.js";
import { pushDefined, pushTruthy } from "./cli-args.js";

export const memoryUpdate = {
  name: "memory-update",
  label: "Memory update",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  description:
    "Update a memory node's content (patch or append) and/or metadata. Patch mode (old_string/new_string) and append mode are mutually exclusive.",
  parameters: Type.Object({
    uri: Type.String({
      description: "Node URI in domain://path format (e.g. 'core://agent/identity').",
    }),
    old_string: Type.Optional(
      Type.String({
        description: "Text to find and replace (must match exactly once).",
      }),
    ),
    new_string: Type.Optional(
      Type.String({
        description: "Replacement text. Empty string to delete the matched text.",
      }),
    ),
    append: Type.Optional(
      Type.String({
        description: "Text to append to content (mutually exclusive with patch).",
      }),
    ),
    priority: Type.Optional(Type.Number({ description: "New priority." })),
    disclosure: Type.Optional(Type.String({ description: "New disclosure/trigger condition." })),
  }),
  execute: async (_id: string, args: Record<string, unknown>, signal?: AbortSignal) => {
    try {
      const result = await runHat(buildUpdateCliArgs(args), { signal });
      return jsonResult(result, buildUpdateDetails(args));
    } catch (e) {
      return jsonError(e);
    }
  },
};

function buildUpdateCliArgs(args: Record<string, unknown>): string[] {
  const cliArgs = ["memory", "update", args.uri as string];
  pushDefined(cliArgs, "--old-string", args.old_string);
  pushDefined(cliArgs, "--new-string", args.new_string);
  pushTruthy(cliArgs, "--append", args.append);
  pushDefined(cliArgs, "--priority", args.priority);
  pushDefined(cliArgs, "--disclosure", args.disclosure);
  return cliArgs;
}

function updateMode(args: Record<string, unknown>): "patch" | "append" | "meta" {
  if (args.old_string !== undefined && args.new_string !== undefined) return "patch";
  return args.append !== undefined ? "append" : "meta";
}

function sumLines(changes: Change[], pick: (change: Change) => boolean): number {
  return changes.filter(pick).reduce((sum, change) => sum + (change.count ?? 0), 0);
}

function diffLineCounts(oldString: string, newString: string): { additions: number; removals: number } {
  const changes = diffLines(oldString, newString);
  return {
    additions: sumLines(changes, (change) => change.added),
    removals: sumLines(changes, (change) => change.removed),
  };
}

function patchDetails(args: Record<string, unknown>): Record<string, unknown> {
  const counts = diffLineCounts(args.old_string as string, args.new_string as string);
  return {
    diff_adds: counts.additions,
    diff_removes: counts.removals,
    old_string: args.old_string,
    new_string: args.new_string,
  };
}

function buildUpdateDetails(args: Record<string, unknown>): Record<string, unknown> {
  const details: Record<string, unknown> = { uri: args.uri };
  const mode = updateMode(args);
  details.mode = mode;
  if (mode === "patch") Object.assign(details, patchDetails(args));
  if (args.priority !== undefined) details.priority = args.priority;
  if (args.disclosure !== undefined) details.disclosure = args.disclosure;
  return details;
}
