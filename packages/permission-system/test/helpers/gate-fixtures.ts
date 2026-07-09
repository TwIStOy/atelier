import { vi } from "vitest";
import type { PermissionCheckResult, ScopedPermissionResolver, ToolCallContext } from "../../src/types.ts";

/** Tool-call context factory with bash defaults. */
export function makeTcc(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    toolName: "bash",
    agentName: null,
    input: { command: "cat .env" },
    cwd: "/test/project",
    ...overrides,
  };
}

export function makeResolver(defaultCheck?: PermissionCheckResult) {
  const resolve = vi.fn<ScopedPermissionResolver["resolve"]>();
  if (defaultCheck) {
    resolve.mockReturnValue(defaultCheck);
  }
  return { resolve };
}

export function makeCheckResult(overrides: Partial<PermissionCheckResult> = {}): PermissionCheckResult {
  return {
    state: "allow",
    toolName: "read",
    source: "tool",
    origin: "builtin",
    ...overrides,
  };
}

export function makeGateCheckResult(overrides: Partial<PermissionCheckResult> = {}): PermissionCheckResult {
  return {
    toolName: "path",
    state: "allow",
    source: "special",
    origin: "global",
    ...overrides,
  };
}

export function makePathDispatchResolver(
  byPath: Record<string, PermissionCheckResult>,
  defaultResult: PermissionCheckResult,
) {
  const resolve = vi.fn<ScopedPermissionResolver["resolve"]>();
  resolve.mockImplementation((intent: any) => {
    if (intent.kind === "tool") {
      const path = intent.input?.path;
      if (typeof path === "string" && path in byPath) {
        return byPath[path];
      }
      return defaultResult;
    }
    if (intent.kind === "access-path") {
      const values = intent.path?.matchValues() ?? [];
      for (const value of values) {
        if (value in byPath) return byPath[value];
      }
    }
    return defaultResult;
  });
  return { resolve };
}
