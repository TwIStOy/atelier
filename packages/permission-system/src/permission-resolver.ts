import type { AccessPath } from "./access-intent/access-path.ts";
import { evaluate, evaluateMostRestrictive, type Rule, type Ruleset } from "./rule.ts";
import type { AccessIntent, PermissionCheckResult, ScopedPermissionResolver } from "./types.ts";

/**
 * Concrete resolver: holds a compiled ruleset (from a merged + defaulted config
 * via `normalizeFlatConfig`) and answers the `AccessIntent` a gate emits.
 *
 * - A `tool` intent is evaluated as `evaluate(surface, <stringified input>)`.
 *   For bash the surface is "bash" and the value is the command string; for a
 *   per-tool check the surface is the tool name and the value is the tool name
 *   (so a bare `read: "ask"` rule matches).
 * - An `access-path` intent is evaluated across `AccessPath.matchValues()`
 *   (lexical ∪ canonical aliases) via `evaluateMostRestrictive`, so a path
 *   rule on either form matches (#418).
 *
 * `matchedPattern` is left `undefined` when only the synthesized default fired
 * (no explicit rule), so gates can treat "no explicit rule" specially (#58).
 */
export class PermissionResolver implements ScopedPermissionResolver {
  constructor(private readonly rules: Ruleset) {}

  resolve(intent: AccessIntent): PermissionCheckResult {
    if (intent.kind === "access-path") {
      return this.resolveAccessPath(intent.surface, intent.path, intent.agentName);
    }
    return this.resolveTool(intent.surface, intent.input, intent.agentName);
  }

  /** Evaluate a tool/command surface against a single string value. */
  resolveTool(surface: string, input: unknown, agentName?: string): PermissionCheckResult {
    const value = toolValue(surface, input);
    const rule = evaluate(surface, value, this.rules);
    return toCheckResult(surface, rule, value, agentName);
  }

  /** Evaluate a path surface across the access path's match aliases. */
  resolveAccessPath(surface: string, path: AccessPath, agentName?: string): PermissionCheckResult {
    const values = path.matchValues();
    const worst = evaluateMostRestrictive(surface, values, this.rules);
    if (worst === null) {
      // All aliases evaluated to allow with no explicit rule → universal default.
      return {
        state: "allow",
        toolName: surface,
        source: "special",
        matchedPattern: undefined,
      };
    }
    return toCheckResult(surface, worst.rule, worst.value, agentName);
  }
}

/** The string value a surface matches against: bash → command, else the surface name. */
function toolValue(surface: string, input: unknown): string {
  if (surface === "bash") {
    const command = (input as { command?: unknown })?.command;
    return typeof command === "string" ? command : "";
  }
  // Per-tool / universal surfaces match against the surface name itself, so a
  // bare `read: "ask"` rule (pattern "*") matches any read call.
  return surface;
}

function toCheckResult(surface: string, rule: Rule, value: string, _agentName?: string): PermissionCheckResult {
  // evaluate() returns a synthesized fallback { pattern: value } when no rule
  // matches; that is the "no explicit rule" signal gates look for (#58).
  const isSynthesizedDefault = rule.pattern === value;
  const source: PermissionCheckResult["source"] = surface === "bash" ? "bash" : "tool";
  return {
    state: rule.action,
    toolName: surface,
    source,
    matchedPattern: isSynthesizedDefault ? undefined : rule.pattern,
    reason: rule.reason,
  };
}
