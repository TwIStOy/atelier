import { Type } from "@sinclair/typebox";
import { runHat } from "../cli-runner.js";
import { jsonError, jsonResult } from "../tool-result.js";
import { pushCsv } from "./cli-args.js";

export const memoryTriggers = {
  name: "memory-triggers",
  label: "Memory triggers",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  description:
    "Manage glossary trigger keywords for a node. When a keyword appears in any memory's content, the system auto-links to the target node.",
  parameters: Type.Object({
    uri: Type.String({
      description: "Target node URI in domain://path format (e.g. 'core://agent/identity').",
    }),
    add: Type.Optional(
      Type.Array(Type.String(), {
        description: "Keywords to bind to this node.",
      }),
    ),
    remove: Type.Optional(
      Type.Array(Type.String(), {
        description: "Keywords to unbind from this node.",
      }),
    ),
  }),
  execute: async (_id: string, args: Record<string, unknown>, signal?: AbortSignal) => {
    try {
      const result = await runHat(buildTriggersCliArgs(args), { signal });
      return jsonResult(result, {
        uri: args.uri,
        added: itemCount(args.add),
        removed: itemCount(args.remove),
      });
    } catch (e) {
      return jsonError(e);
    }
  },
};

function buildTriggersCliArgs(args: Record<string, unknown>): string[] {
  const cliArgs = ["memory", "triggers", args.uri as string];
  pushCsv(cliArgs, "--add", args.add);
  pushCsv(cliArgs, "--remove", args.remove);
  return cliArgs;
}

function itemCount(value: unknown): number {
  return (value as string[] | undefined)?.length ?? 0;
}
