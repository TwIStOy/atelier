import { Type } from "@sinclair/typebox";
import { runHat } from "../cli-runner.js";
import { contentLines, jsonError, jsonResult, textContent } from "../tool-result.js";

export const memoryRead = {
  name: "memory-read",
  label: "Memory read",
  annotations: { readOnlyHint: true },
  description:
    "Read a memory node by URI. Supports regular URIs (e.g. 'core://agent/identity') and system URIs (e.g. 'system://boot', 'system://index', 'system://glossary').",
  parameters: Type.Object({
    uri: Type.String({
      description: "Memory URI (e.g. 'core://agent/identity') or system URI (e.g. 'system://boot').",
    }),
  }),
  execute: async (_id: string, args: Record<string, unknown>, signal?: AbortSignal) => {
    try {
      const result = await runHat(["memory", "read", args.uri as string], { signal });
      const content = textContent(result);
      return jsonResult(result, {
        uri: args.uri,
        content_preview: content.slice(0, 200),
        content_lines: contentLines(content),
      });
    } catch (e) {
      return jsonError(e);
    }
  },
};
