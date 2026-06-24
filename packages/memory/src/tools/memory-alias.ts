import { Type } from "@sinclair/typebox";
import { runHat } from "../cli-runner.js";
import { jsonError, jsonResult } from "../tool-result.js";

export const memoryAlias = {
  name: "memory-alias",
  label: "Memory alias",
  description:
    "Create or remove an alias (virtual path) pointing to an existing node. Not a copy — same content, independent priority and disclosure.",
  parameters: Type.Object({
    new_uri: Type.Optional(
      Type.String({
        description: "The alias URI to create, in domain://path format (e.g. 'notes://shortcuts/my-alias').",
      }),
    ),
    target_uri: Type.Optional(
      Type.String({
        description: "The existing node URI to point to, in domain://path format (e.g. 'core://agent/identity').",
      }),
    ),
    remove_uri: Type.Optional(
      Type.String({
        description: "The alias URI to remove, in domain://path format.",
      }),
    ),
    priority: Type.Optional(
      Type.Number({
        description: "Independent priority for this alias.",
      }),
    ),
    disclosure: Type.Optional(
      Type.String({
        description: "Independent disclosure for this alias.",
      }),
    ),
  }),
  execute: async (_id: string, args: Record<string, unknown>) => {
    try {
      if (args.remove_uri) {
        const result = await runHat(["memory", "alias", "--remove-uri", args.remove_uri as string]);
        return jsonResult(result, {
          is_remove: true,
          uri: args.remove_uri,
        });
      }
      if (!args.new_uri || !args.target_uri) {
        return jsonResult({
          error: "Provide new_uri + target_uri to create, or remove_uri to delete.",
        });
      }
      const cliArgs = [
        "memory",
        "alias",
        "--new-uri",
        args.new_uri as string,
        "--target-uri",
        args.target_uri as string,
      ];
      if (args.priority !== undefined) cliArgs.push("--priority", String(args.priority));
      if (args.disclosure) cliArgs.push("--disclosure", args.disclosure as string);
      const result = await runHat(cliArgs);
      return jsonResult(result, {
        is_remove: false,
        uri: args.new_uri,
        target_uri: args.target_uri,
      });
    } catch (e) {
      return jsonError(e);
    }
  },
};
