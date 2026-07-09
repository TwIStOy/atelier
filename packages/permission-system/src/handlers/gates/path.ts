import type { PathNormalizer } from "../../path-normalizer.ts";
import { actionFromTool } from "../../path-surfaces.ts";
import { getToolInputPath } from "../../tool-input-path.ts";
import type { AccessIntent, GateResult, ScopedPermissionResolver, ToolCallContext } from "../../types.ts";

/**
 * Cross-cutting `path` permission gate (tools).
 *
 * Returns `null` when the gate does not apply (tool is not path-bearing, no
 * extractable path, the `path` surface evaluates to `allow`, or no explicit
 * `path` rule matched — only the universal default fired).
 */
export function describePathGate(
  tcc: ToolCallContext,
  resolver: ScopedPermissionResolver,
  normalizer: PathNormalizer,
): GateResult | null {
  const filePath = getToolInputPath(tcc.toolName, tcc.input);
  if (!filePath) return null;

  const accessPath = normalizer.forPath(filePath);
  const intent: AccessIntent = {
    kind: "access-path",
    surface: "path",
    path: accessPath,
    agentName: tcc.agentName ?? undefined,
  };
  const check = resolver.resolve(intent);

  if (check.state === "allow") return null;

  // No explicit path rule matched — only the universal default fired.
  // Skip to preserve backward compatibility: configs without a "path" key
  // should not trigger path-level prompts (#58).
  if (check.matchedPattern === undefined) return null;

  return {
    state: check.state,
    action: actionFromTool(tcc.toolName),
    trigger: { kind: "path", path: accessPath, display: filePath },
    reason: check.state === "deny" ? `path rule '${check.matchedPattern}' denies '${filePath}'` : undefined,
  };
}
