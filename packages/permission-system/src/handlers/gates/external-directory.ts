import type { PathNormalizer } from "../../path-normalizer.ts";
import { actionFromTool } from "../../path-surfaces.ts";
import { getToolInputPath } from "../../tool-input-path.ts";
import type { GateResult, ScopedPermissionResolver, ToolCallContext } from "../../types.ts";
import { resolveExternalDirectoryPolicy } from "./external-directory-policy.ts";

/**
 * External-directory permission gate (tools): guards against a path-bearing
 * tool reaching outside the working directory.
 *
 * Returns `null` when the gate does not apply (no extractable path, or path is
 * inside the working directory). Otherwise returns the `external_directory`
 * surface's resolved state.
 *
 * The Pi infrastructure-read auto-allow bypass is deferred to Step 5 (it needs
 * the config-derived infra-dirs list); v1 always proceeds to the check.
 */
export function describeExternalDirectoryGate(
  tcc: ToolCallContext,
  infraDirs: string[],
  resolver: ScopedPermissionResolver,
  normalizer: PathNormalizer,
): GateResult | null {
  const externalDirectoryPath = getToolInputPath(tcc.toolName, tcc.input);
  if (!externalDirectoryPath) return null;

  if (!normalizer.isOutsideWorkingDirectory(externalDirectoryPath)) {
    return null;
  }

  const accessPath = normalizer.forPath(externalDirectoryPath);
  const check = resolveExternalDirectoryPolicy(accessPath, resolver, tcc.agentName ?? undefined);

  if (check.state === "allow") return null;

  // infraDirs is accepted but unused in v1; Step 5 wires it in.
  void infraDirs;

  return {
    state: check.state,
    action: actionFromTool(tcc.toolName),
    trigger: { kind: "path", surface: "external_directory", path: accessPath, display: externalDirectoryPath },
    reason: check.state === "deny" ? `path '${externalDirectoryPath}' is outside the working directory` : undefined,
  };
}
