import { getGlobalState } from "./global-state.ts";

/**
 * Aggregate Rule registry: `toolName → { verb, singular, plural, progressive }`.
 *
 * Tool-display's verb-group and truncation layers phrase their header rows from
 * these rules. The built-in four (`grep` / `glob` / `ls` / `read`) and
 * extension-registered rules share one table; a tool name without a rule is not
 * a verb-group Member. Register directly via {@link registerAggregateRule} when
 * the extension depends on common, or emit {@link AGGREGATE_RULE_REGISTER_EVENT}
 * on `pi.events` (payload `{ toolName, rule }`) for a dependency-free path —
 * tool-display bridges that event into this registry and emits
 * {@link AGGREGATE_RULE_READY_EVENT} once it listens.
 */
export interface AggregateRule {
  /** Past-tense verb for a settled group: `Read 2 files`. */
  verb: string;
  /** Noun for a single member: `file`. */
  singular: string;
  /** Noun for multiple members: `files`. */
  plural: string;
  /** Progressive phrase used while any member of the kind is still partial: `Reading…`. */
  progressive: string;
}

export const AGGREGATE_RULE_REGISTER_EVENT = "tool-display:register-aggregate-rule" as const;
export const AGGREGATE_RULE_READY_EVENT = "tool-display:aggregate-rules-ready" as const;

const BUILTIN_RULES: Readonly<Record<string, AggregateRule>> = {
  grep: { verb: "Searched", singular: "pattern", plural: "patterns", progressive: "Searching…" },
  glob: { verb: "Matched", singular: "glob", plural: "globs", progressive: "Matching…" },
  ls: { verb: "Listed", singular: "dir", plural: "dirs", progressive: "Listing…" },
  read: { verb: "Read", singular: "file", plural: "files", progressive: "Reading…" },
};

// The registry lives in Symbol.for-keyed global state and built-ins seed inside
// the init callback: pi loads each extension through a separate jiti module graph
// (moduleCache: false), so every extension re-evaluates this module. A plain
// module-level Map would give each extension its own copy, and a top-level
// reset would wipe registrations made by earlier-loaded extensions.
const registry = getGlobalState("htwang-contrib-aggregate-rules", () => {
  const map = new Map<string, AggregateRule>();
  for (const [name, rule] of Object.entries(BUILTIN_RULES)) {
    map.set(name, rule);
  }
  return map;
});

function resetRegistry(): void {
  registry.clear();
  for (const [name, rule] of Object.entries(BUILTIN_RULES)) {
    registry.set(name, rule);
  }
}

function rulesEqual(a: AggregateRule, b: AggregateRule): boolean {
  return a.verb === b.verb && a.singular === b.singular && a.plural === b.plural && a.progressive === b.progressive;
}

/**
 * Register an Aggregate Rule for a tool name. Returns `false` when a different
 * rule already owns the name (the first registration wins); re-registering an
 * identical rule is a no-op so extension reloads stay safe.
 */
export function registerAggregateRule(toolName: string, rule: AggregateRule): boolean {
  const existing = registry.get(toolName);
  if (existing) return rulesEqual(existing, rule);
  registry.set(toolName, rule);
  return true;
}

export function aggregateRuleFor(toolName: string): AggregateRule | undefined {
  return registry.get(toolName);
}

/** Test-only escape hatch: drop custom rules back to the built-in set. */
export function resetAggregateRulesForTest(): void {
  resetRegistry();
}
