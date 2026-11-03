import { Type } from "@sinclair/typebox";
import { runHat } from "../cli-runner.js";
import { jsonError, jsonResult } from "../tool-result.js";
import { parseListResult } from "./parse-list.js";

export const memoryDomains = {
  name: "memory-domains",
  label: "Memory domains",
  annotations: { readOnlyHint: true },
  description: "List all memory domains with their node counts.",
  parameters: Type.Object({}),
  execute: async (_id: string, _args: Record<string, unknown>, signal?: AbortSignal) => {
    try {
      const result = await runHat(["memory", "domains"], { signal });
      const items = (parseListResult(result, "domains") as unknown[]).map(domainItem);
      return jsonResult(result, {
        total: items.length,
        domains: items,
      });
    } catch (e) {
      return jsonError(e);
    }
  },
};

function domainItemName(item: Record<string, unknown>): unknown {
  return item.name ?? item.domain ?? item.id ?? "?";
}

function domainItem(d: unknown): unknown {
  if (typeof d === "string") return d;
  const item = d as Record<string, unknown>;
  const name = domainItemName(item);
  const count = item.count ?? item.node_count;
  return count !== undefined ? `${name} (${count})` : name;
}
