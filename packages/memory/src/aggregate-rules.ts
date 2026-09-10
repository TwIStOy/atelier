import { registerAggregateRule } from "@htwang-contrib/common";

const MEMORY_AGGREGATE_RULES = {
  "memory-read": { verb: "Read", singular: "memory", plural: "memories", progressive: "Reading…" },
  "memory-search": { verb: "Searched", singular: "memory", plural: "memories", progressive: "Searching…" },
  "memory-list": { verb: "Listed", singular: "memory tree", plural: "memory trees", progressive: "Listing…" },
  "memory-history": { verb: "Read", singular: "memory history", plural: "memory histories", progressive: "Reading…" },
  "memory-domains": { verb: "Listed", singular: "domain", plural: "domains", progressive: "Listing…" },
  "journal-read": { verb: "Read", singular: "journal entry", plural: "journal entries", progressive: "Reading…" },
  "journal-search": {
    verb: "Searched",
    singular: "journal entry",
    plural: "journal entries",
    progressive: "Searching…",
  },
} as const;

export function registerMemoryAggregateRules(): void {
  for (const [toolName, rule] of Object.entries(MEMORY_AGGREGATE_RULES)) {
    registerAggregateRule(toolName, rule);
  }
}
