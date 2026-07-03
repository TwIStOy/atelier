import { Type } from "@sinclair/typebox";
import { runHat } from "../cli-runner.js";
import { jsonError, jsonResult } from "../tool-result.js";

export const memoryDelete = {
  name: "memory-delete",
  label: "Memory delete",
  description: "Delete a memory node. Removes the file but does not remove aliases pointing to it.",
  parameters: Type.Object({
    uri: Type.String({
      description: "Node URI in domain://path format (e.g. 'core://agent/identity').",
    }),
  }),
  execute: async (_id: string, args: Record<string, unknown>, signal?: AbortSignal) => {
    try {
      const result = await runHat(["memory", "delete", args.uri as string], { signal });
      return jsonResult(result, { uri: args.uri });
    } catch (e) {
      return jsonError(e);
    }
  },
};
