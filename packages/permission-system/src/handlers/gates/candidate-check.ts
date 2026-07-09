import type { PermissionCheckResult, PermissionState } from "../../types.ts";

const RESTRICTIVENESS: Record<PermissionState, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
};

export function pickMostRestrictive(results: readonly PermissionCheckResult[]): PermissionCheckResult | undefined {
  let worst: PermissionCheckResult | undefined;
  for (const result of results) {
    if (worst === undefined || RESTRICTIVENESS[result.state]! > RESTRICTIVENESS[worst.state]!) {
      worst = result;
    }
  }
  return worst;
}
