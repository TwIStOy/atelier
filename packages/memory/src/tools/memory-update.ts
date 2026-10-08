import { Type } from "@sinclair/typebox";
import { diffLines } from "diff";
import { runHat } from "../cli-runner.js";
import { jsonError, jsonResult } from "../tool-result.js";

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
      const cliArgs = ["memory", "update", args.uri as string];
      if (args.old_string !== undefined) cliArgs.push("--old-string", args.old_string as string);
      if (args.new_string !== undefined) cliArgs.push("--new-string", args.new_string as string);
      if (args.append) cliArgs.push("--append", args.append as string);
      if (args.priority !== undefined) cliArgs.push("--priority", String(args.priority));
      if (args.disclosure !== undefined) cliArgs.push("--disclosure", args.disclosure as string);
      const result = await runHat(cliArgs, { signal });

      const details: Record<string, unknown> = { uri: args.uri };
      if (args.old_string !== undefined && args.new_string !== undefined) {
        const changes = diffLines(args.old_string as string, args.new_string as string);
        let additions = 0;
        let removals = 0;
        for (const change of changes) {
          if (change.added) additions += change.count ?? 0;
          if (change.removed) removals += change.count ?? 0;
        }
        details.mode = "patch";
        details.diff_adds = additions;
        details.diff_removes = removals;
        details.old_string = args.old_string;
        details.new_string = args.new_string;
      } else if (args.append !== undefined) {
        details.mode = "append";
      } else {
        details.mode = "meta";
      }
      if (args.priority !== undefined) details.priority = args.priority;
      if (args.disclosure !== undefined) details.disclosure = args.disclosure;

      return jsonResult(result, details);
    } catch (e) {
      return jsonError(e);
    }
  },
};
