import type { AccessPath } from "../../access-intent/access-path.ts";
import type { BashProgram } from "../../access-intent/bash/program.ts";
import type {
  AccessIntent,
  GateResult,
  PermissionCheckResult,
  ScopedPermissionResolver,
  ToolCallContext,
} from "../../types.ts";
import { getNonEmptyString, toRecord } from "../../value-guards.ts";
import { pickMostRestrictive } from "./candidate-check.ts";

/**
 * Cross-cutting `path` permission gate (bash).
 *
 * Reads path-rule candidates from the injected `BashProgram`, evaluates each
 * against the `path` surface, and returns the most restrictive state.
 *
 * Returns `null` when the gate does not apply (not bash, no command, no
 * tokens, or all tokens evaluate to `allow`). Otherwise returns the worst
 * state across tokens (deny > ask > allow).
 */
export function describeBashPathGate(
  tcc: ToolCallContext,
  bashProgram: BashProgram | null,
  resolver: ScopedPermissionResolver,
): GateResult | null {
  if (tcc.toolName !== "bash") return null;

  const command = getNonEmptyString(toRecord(tcc.input).command);
  if (!command) return null;
  if (!bashProgram) return null;

  const candidates = bashProgram.pathRuleCandidates();
  if (candidates.length === 0) return null;

  // Pair each gated candidate with its check, then pick the most restrictive.
  const entries: Array<{ token: string; path: AccessPath; check: PermissionCheckResult }> = [];
  for (const { token, path } of candidates) {
    const intent: AccessIntent = {
      kind: "access-path",
      surface: "path",
      path,
      agentName: tcc.agentName ?? undefined,
    };
    const check = resolver.resolve(intent);

    // No explicit path rule matched — only the universal default fired.
    if (check.matchedPattern === undefined && check.source !== "session") {
      continue;
    }

    entries.push({ token, path, check });
    if (check.state === "deny") break; // Short-circuit on deny.
    // allow and ask both get recorded; pickMostRestrictive picks the worst.
  }

  // Drop allow entries — a gate result is only meaningful for ask/deny.
  const gated = entries.filter((e) => e.check.state !== "allow");
  const worst = pickMostRestrictive(gated.map((e) => e.check));
  if (!worst) return null;
  const worstEntry = gated.find((e) => e.check === worst)!;

  return {
    state: worst.state,
    action: "read",
    trigger: { kind: "path", surface: "path", path: worstEntry.path, display: worstEntry.token },
    reason: worst.state === "deny" ? `path rule '${worst.matchedPattern}' denies a bash path token` : undefined,
  };
}
