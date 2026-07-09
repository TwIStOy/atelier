import type { AccessPath } from "../../access-intent/access-path.ts";
import type { AccessIntent, PermissionCheckResult, ScopedPermissionResolver } from "../../types.ts";
import { pickMostRestrictive } from "./candidate-check.ts";

export interface UncoveredExternalPath {
  path: AccessPath;
  check: PermissionCheckResult;
}

export interface UncoveredExternalPaths {
  uncovered: UncoveredExternalPath[];
  worstCheck: PermissionCheckResult | undefined;
}

/**
 * Resolve one external path's policy on the `external_directory` surface.
 * Emits an `access-path` intent so the resolver matches lexical ∪ canonical
 * aliases (#418).
 */
export function resolveExternalDirectoryPolicy(
  path: AccessPath,
  resolver: ScopedPermissionResolver,
  agentName: string | undefined,
): PermissionCheckResult {
  const intent: AccessIntent = {
    kind: "access-path",
    surface: "external_directory",
    path,
    agentName,
  };
  return resolver.resolve(intent);
}

/**
 * Resolve a set of external paths and select those not already allowed.
 * Filters on state (not source), so a config-level allow suppresses the
 * prompt just as a session-level allow does. Returns the most restrictive
 * uncovered check so a config "deny" is not downgraded to the catch-all ask.
 */
export function selectUncoveredExternalPaths(
  paths: readonly AccessPath[],
  resolver: ScopedPermissionResolver,
  agentName: string | undefined,
): UncoveredExternalPaths {
  const uncovered: UncoveredExternalPath[] = [];
  for (const path of paths) {
    const check = resolveExternalDirectoryPolicy(path, resolver, agentName);
    if (check.state !== "allow") {
      uncovered.push({ path, check });
    }
  }
  return {
    uncovered,
    worstCheck: pickMostRestrictive(uncovered.map(({ check }) => check)),
  };
}
