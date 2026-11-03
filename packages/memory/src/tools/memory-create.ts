import { Type } from "@sinclair/typebox";
import { runHat } from "../cli-runner.js";
import { jsonError, jsonResult } from "../tool-result.js";
import { pushDefined, pushTruthy } from "./cli-args.js";

export const memoryCreate = {
  name: "memory-create",
  label: "Memory create",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  description: "Create a new child memory node under a parent URI. URI format: domain://path (e.g. 'core://agent').",
  parameters: Type.Object({
    parent_uri: Type.String({
      description: "Parent URI (e.g. 'core://agent'). Use 'core://' for domain root.",
    }),
    content: Type.String({
      description: "Memory content (supports Markdown).",
    }),
    priority: Type.Optional(
      Type.Number({
        description: "Priority: 0 (highest) to 9 (lowest). Default 5.",
      }),
    ),
    title: Type.Optional(
      Type.String({
        description: "Path segment name (a-z, 0-9, _, -). Auto-assigned if omitted.",
      }),
    ),
    disclosure: Type.Optional(
      Type.String({
        description: "When to recall: trigger condition for this memory.",
      }),
    ),
  }),
  execute: async (_id: string, args: Record<string, unknown>, signal?: AbortSignal) => {
    try {
      const result = await runHat(buildCreateCliArgs(args), { signal });
      return jsonResult(result, {
        parent_uri: args.parent_uri,
        title: args.title ?? "",
        content_preview: (args.content as string).slice(0, 200),
        content_lines: (args.content as string).split("\n").length,
      });
    } catch (e) {
      return jsonError(e);
    }
  },
};

function buildCreateCliArgs(args: Record<string, unknown>): string[] {
  const cliArgs = ["memory", "create", args.parent_uri as string, args.content as string];
  pushDefined(cliArgs, "--priority", args.priority);
  pushTruthy(cliArgs, "--title", args.title);
  pushTruthy(cliArgs, "--disclosure", args.disclosure);
  return cliArgs;
}
