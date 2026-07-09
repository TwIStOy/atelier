import type { FlatPermissionConfig, PermissionState } from "./config-schema.ts";
import { isDenyWithReason, isPermissionState } from "./config-schema.ts";
import { PATH_SURFACES } from "./path-surfaces.ts";
import { type WildcardMatchOptions, wildcardMatch } from "./wildcard-matcher.ts";
/** A single permission rule — the atomic unit of policy. */
export interface Rule {
  surface: string;
  pattern: string;
  action: PermissionState;
  /** Custom denial reason for deny rules (optional). */
  reason?: string;
}

/** An ordered list of rules. Later rules take priority (last-match-wins). */
export type Ruleset = Rule[];

/**
 * Flatten a validated flat permission config into an ordered ruleset.
 *
 * A bare-string surface becomes a `{ pattern: "*" }` rule; an object surface
 * becomes one rule per pattern. `DenyWithReason` objects unwrap to a deny rule
 * carrying the reason. Order follows Object.entries insertion order, which
 * preserves the user's "broad first, specific after" intent for last-match-wins.
 */
export function normalizeFlatConfig(permission: FlatPermissionConfig): Ruleset {
  const rules: Rule[] = [];
  for (const [surface, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      if (isPermissionState(value)) {
        rules.push({ surface, pattern: "*", action: value });
      }
    } else if (typeof value === "object" && value !== null) {
      for (const [pattern, action] of Object.entries(value)) {
        if (isDenyWithReason(action)) {
          rules.push({ surface, pattern, action: "deny", reason: action.reason });
        } else if (isPermissionState(action)) {
          rules.push({ surface, pattern, action });
        }
      }
    }
  }
  return rules;
}

/** Windows path-surface matching folds case + separators; only on win32. */
function pathMatchOptions(surface: string, platform: NodeJS.Platform): WildcardMatchOptions | undefined {
  return platform === "win32" && PATH_SURFACES.has(surface)
    ? { caseInsensitive: true, windowsSeparators: true }
    : undefined;
}

function ruleMatches(rule: Rule, surface: string, value: string, platform: NodeJS.Platform): boolean {
  return (
    wildcardMatch(rule.surface, surface) && wildcardMatch(rule.pattern, value, pathMatchOptions(surface, platform))
  );
}

/**
 * Evaluate one surface+value against a ruleset. Last matching rule wins; if
 * none match, fall back to `defaultAction` (ask by default).
 */
export function evaluate(
  surface: string,
  value: string,
  rules: Ruleset,
  platform: NodeJS.Platform = process.platform,
  defaultAction: PermissionState = "ask",
): Rule {
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i]!;
    if (ruleMatches(rule, surface, value, platform)) return rule;
  }
  return { surface, pattern: value, action: defaultAction };
}

/**
 * Evaluate a surface against multiple values, returning the most restrictive
 * non-allow result (deny > ask). Used by the cross-cutting `path` surface to
 * aggregate across multiple path aliases. Returns `null` when all allow.
 */
export function evaluateMostRestrictive(
  surface: string,
  values: string[],
  rules: Ruleset,
  platform: NodeJS.Platform = process.platform,
): { rule: Rule; value: string } | null {
  let worst: { rule: Rule; value: string } | null = null;
  for (const value of values) {
    const rule = evaluate(surface, value, rules, platform);
    if (rule.action === "deny") return { rule, value };
    if (rule.action === "ask" && worst?.rule.action !== "ask") {
      worst = { rule, value };
    }
  }
  return worst;
}
