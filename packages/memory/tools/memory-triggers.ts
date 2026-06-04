import { Type } from "@sinclair/typebox";
import { runHat } from "../cli-runner.js";
import { jsonError, jsonResult } from "../tool-result.js";

export const memoryTriggers = {
  name: "memory-triggers",
  label: "Memory triggers",
  description:
    "Manage glossary trigger keywords for a node. When a keyword appears in any memory's content, the system auto-links to the target node.",
  parameters: Type.Object({
    uri: Type.String({
      description:
        "Target node URI in domain://path format (e.g. 'core://agent/identity').",
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
  execute: async (_id: string, args: Record<string, unknown>) => {
    try {
      const cliArgs = ["memory", "triggers", args.uri as string];
      if ((args.add as string[])?.length)
        cliArgs.push("--add", (args.add as string[]).join(","));
      if ((args.remove as string[])?.length)
        cliArgs.push("--remove", (args.remove as string[]).join(","));
      const result = await runHat(cliArgs);
      return jsonResult(result, {
        uri: args.uri,
        added: (args.add as string[])?.length ?? 0,
        removed: (args.remove as string[])?.length ?? 0,
      });
    } catch (e) {
      return jsonError(e);
    }
  },
};
