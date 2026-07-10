import type { AccessPath } from "../../access-intent/access-path.ts";
import { prefix as commandPrefix } from "../../bash-arity.ts";
import { actionFromTool } from "../../path-surfaces.ts";
import type { GateResult, GateTrigger, PermissionCheckResult, ToolCallContext } from "../../types.ts";
import { getNonEmptyString, toRecord } from "../../value-guards.ts";

/**
 * Per-tool permission gate (the final gate).
 *
 * Takes a pre-computed PermissionCheckResult (the Step 5 pipeline resolves it
 * — for bash via resolveBashCommandCheck, for a path-bearing tool via an
 * access-path intent, otherwise a plain tool intent) and returns its state.
 *
 * The trigger is derived from the tool shape: bash → command (with a
 * subcommand prefix via bash-arity), a path-bearing tool → path, else none.
 * The caller may pass `accessPath` to carry the resolved aliases for a
 * path-bearing tool so a session-allow layer can match lexical ∪ canonical.
 */
export function describeToolGate(
  tcc: ToolCallContext,
  check: PermissionCheckResult,
  accessPath?: AccessPath,
): GateResult {
  const trigger = deriveToolTrigger(tcc, accessPath);
  return {
    state: check.state,
    action: actionFromTool(tcc.toolName),
    trigger,
    reason:
      check.state === "deny"
        ? (check.reason ?? `rule '${check.matchedPattern}' denies tool '${check.toolName}'`)
        : undefined,
  };
}

function deriveToolTrigger(tcc: ToolCallContext, accessPath: AccessPath | undefined): GateTrigger {
  if (tcc.toolName === "bash") {
    const command = getNonEmptyString(toRecord(tcc.input).command);
    if (command) {
      const prefixTokens = commandPrefix(command.trim().split(/\s+/).filter(Boolean));
      return { kind: "command", command, prefix: prefixTokens.join(" ") };
    }
  }
  const path = getNonEmptyString(toRecord(tcc.input).path);
  if (path && accessPath) {
    return { kind: "path", surface: "path", path: accessPath, display: path };
  }
  return { kind: "none", toolName: tcc.toolName };
}
