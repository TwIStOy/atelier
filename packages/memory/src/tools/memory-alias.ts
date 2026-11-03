import { Type } from "@sinclair/typebox";
import { runHat } from "../cli-runner.js";
import { jsonError, jsonResult } from "../tool-result.js";
import { pushDefined, pushTruthy } from "./cli-args.js";

export const memoryAlias = {
  name: "memory-alias",
  label: "Memory alias",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
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
  execute: async (_id: string, args: Record<string, unknown>, signal?: AbortSignal) => {
    try {
      const mode = aliasMode(args);
      if (mode === "remove") return removeAlias(args, signal);
      if (mode === "invalid") {
        return jsonResult({
          error: "Provide new_uri + target_uri to create, or remove_uri to delete.",
        });
      }
      return createAlias(args, signal);
    } catch (e) {
      return jsonError(e);
    }
  },
};

function aliasMode(args: Record<string, unknown>): "remove" | "create" | "invalid" {
  if (args.remove_uri) return "remove";
  if (!args.new_uri || !args.target_uri) return "invalid";
  return "create";
}

async function removeAlias(args: Record<string, unknown>, signal?: AbortSignal) {
  const result = await runHat(["memory", "alias", "--remove-uri", args.remove_uri as string], { signal });
  return jsonResult(result, {
    is_remove: true,
    uri: args.remove_uri,
  });
}

async function createAlias(args: Record<string, unknown>, signal?: AbortSignal) {
  const cliArgs = ["memory", "alias", "--new-uri", args.new_uri as string, "--target-uri", args.target_uri as string];
  pushDefined(cliArgs, "--priority", args.priority);
  pushTruthy(cliArgs, "--disclosure", args.disclosure);
  const result = await runHat(cliArgs, { signal });
  return jsonResult(result, {
    is_remove: false,
    uri: args.new_uri,
    target_uri: args.target_uri,
  });
}
