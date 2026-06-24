import { Type } from "@sinclair/typebox";
import { runHat } from "../cli-runner.js";
import { jsonError, jsonResult } from "../tool-result.js";

function parseListResult(result: unknown): unknown[] {
  if (!result || typeof result !== "object") return [];
  if (Array.isArray(result)) return result;
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.domains)) return r.domains;
  if (Array.isArray(r.data)) return r.data;
  return [];
}

export const memoryDomains = {
  name: "memory-domains",
  label: "Memory domains",
  description: "List all memory domains with their node counts.",
  parameters: Type.Object({}),
  execute: async () => {
    try {
      const result = await runHat(["memory", "domains"]);
      const items = parseListResult(result).map((d: unknown) => {
        if (typeof d === "string") return d;
        const item = d as Record<string, unknown>;
        const name = item.name ?? item.domain ?? item.id ?? "?";
        const count = item.count ?? item.node_count;
        return count !== undefined ? `${name} (${count})` : name;
      });
      return jsonResult(result, {
        total: items.length,
        domains: items,
      });
    } catch (e) {
      return jsonError(e);
    }
  },
};
