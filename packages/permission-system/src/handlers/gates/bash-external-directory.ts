import type { BashProgram } from "../../access-intent/bash/program.ts";
import { prefix as commandPrefix } from "../../bash-arity.ts";
import type { GateResult, ScopedPermissionResolver, ToolCallContext } from "../../types.ts";
import { getNonEmptyString, toRecord } from "../../value-guards.ts";
import { selectUncoveredExternalPaths } from "./external-directory-policy.ts";

/**
 * External-directory permission gate (bash): guards against a bash command
 * referencing paths outside the working directory.
 *
 * Returns `null` when the gate does not apply (not bash, no command, no
 * external paths, or all external paths resolve to `allow`). Otherwise
 * returns the most restrictive state across the uncovered external paths.
 */
export function describeBashExternalDirectoryGate(
  tcc: ToolCallContext,
  bashProgram: BashProgram | null,
  resolver: ScopedPermissionResolver,
): GateResult | null {
  if (tcc.toolName !== "bash") return null;

  const command = getNonEmptyString(toRecord(tcc.input).command);
  if (!command) return null;
  if (!bashProgram) return null;

  const externalPaths = bashProgram.externalPaths();
  if (externalPaths.length === 0) return null;

  const { uncovered, worstCheck } = selectUncoveredExternalPaths(externalPaths, resolver, tcc.agentName ?? undefined);

  if (uncovered.length === 0 || !worstCheck) return null;

  const prefixTokens = commandPrefix(command.trim().split(/\s+/).filter(Boolean));
  const subcommand = prefixTokens.join(" ");

  return {
    state: worstCheck.state,
    action: "execute",
    trigger: { kind: "command", command, prefix: subcommand },
    reason:
      worstCheck.state === "deny"
        ? `bash command references ${uncovered.length} path(s) outside the working directory`
        : undefined,
  };
}
