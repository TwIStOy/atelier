import { Type } from "@sinclair/typebox";
import { runHat } from "../cli-runner.js";
import { jsonError, jsonResult } from "../tool-result.js";

export const memoryList = {
  name: "memory-list",
  label: "Memory list",
  description: "List all memory nodes as a tree structure. Optionally filter by domain.",
  parameters: Type.Object({
    domain: Type.Optional(
      Type.String({
        description: "List only nodes in this domain (e.g. 'core', 'notes').",
      }),
    ),
  }),
  execute: async (_id: string, args: Record<string, unknown>) => {
    try {
      const cliArgs = ["memory", "list"];
      if (args.domain) cliArgs.push(args.domain as string);
      const result = await runHat(cliArgs);
      return jsonResult(result, {
        domain: args.domain ?? "",
      });
    } catch (e) {
      return jsonError(e);
    }
  },
};
