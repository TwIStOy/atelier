import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:os", () => ({
  homedir: () => "/fake/home",
  default: { homedir: () => "/fake/home" },
}));

import { AccessPath } from "../src/access-intent/access-path.ts";
import { applyDefaults, mergeFlatPermissions } from "../src/config-loader.ts";
import { PermissionResolver } from "../src/permission-resolver.ts";
import { normalizeFlatConfig } from "../src/rule.ts";
import type { AccessIntent, FlatPermissionConfig } from "../src/types.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function resolverFrom(permission: unknown) {
  const p = permission as FlatPermissionConfig;
  const merged = mergeFlatPermissions(applyDefaults({ permission: p }), {});
  return new PermissionResolver(normalizeFlatConfig(merged));
}

function toolIntent(surface: string, input: unknown): AccessIntent {
  return { kind: "tool", surface, input, agentName: undefined };
}

function pathIntent(path: AccessPath): AccessIntent {
  return { kind: "access-path", surface: "path", path, agentName: undefined };
}

describe("PermissionResolver — tool surface", () => {
  it("allows read by default (dev-friendly defaults)", () => {
    const resolver = resolverFrom({});
    expect(resolver.resolve(toolIntent("read", { path: "src/foo.ts" })).state).toBe("allow");
  });

  it("asks for write by default", () => {
    const resolver = resolverFrom({});
    expect(resolver.resolve(toolIntent("write", { path: "out.ts" })).state).toBe("ask");
  });

  it("asks for bash by default", () => {
    const resolver = resolverFrom({});
    expect(resolver.resolve(toolIntent("bash", { command: "git push" })).state).toBe("ask");
  });

  it("honors an explicit bash allow for git status (last-match-wins)", () => {
    const resolver = resolverFrom({
      bash: { "*": "ask", "git status": "allow", "git diff": "allow" },
    });
    expect(resolver.resolve(toolIntent("bash", { command: "git status" })).state).toBe("allow");
    expect(resolver.resolve(toolIntent("bash", { command: "git push" })).state).toBe("ask");
  });

  it("denies npm with a custom reason via deny-with-reason object", () => {
    const resolver = resolverFrom({
      bash: { "npm *": { action: "deny", reason: "Use pnpm instead" } },
    });
    const result = resolver.resolve(toolIntent("bash", { command: "npm install" }));
    expect(result.state).toBe("deny");
    expect(result.reason).toBe("Use pnpm instead");
  });

  it("matchedPattern is undefined when only the synthesized fallback fires (no rule matched)", () => {
    // An empty ruleset (no defaults) → evaluate synthesizes an ask fallback.
    const resolver = new PermissionResolver([]);
    const result = resolver.resolve(toolIntent("find", { path: "x" }));
    expect(result.state).toBe("ask");
    expect(result.matchedPattern).toBeUndefined();
  });
});

describe("PermissionResolver — path surface (access-path intent)", () => {
  it("denies .env via the default path rule", () => {
    const resolver = resolverFrom({});
    const ap = AccessPath.forPath(".env", { cwd: "/proj", platform: "linux" });
    const result = resolver.resolve(pathIntent(ap));
    expect(result.state).toBe("deny");
  });

  it("allows a normal in-cwd file via the default path:* allow", () => {
    const resolver = resolverFrom({});
    const ap = AccessPath.forPath("src/foo.ts", { cwd: "/proj", platform: "linux" });
    expect(resolver.resolve(pathIntent(ap)).state).toBe("allow");
  });

  it("denies ~/.ssh/* via the default path rule", () => {
    const resolver = resolverFrom({});
    const ap = AccessPath.forPath("~/.ssh/config", { cwd: "/proj", platform: "linux" });
    expect(resolver.resolve(pathIntent(ap)).state).toBe("deny");
  });

  it("a config override can allow a specific .env file (last-match-wins)", () => {
    const resolver = resolverFrom({
      path: { "*.env.example": "allow" },
    });
    const ap = AccessPath.forPath(".env.example", { cwd: "/proj", platform: "linux" });
    expect(resolver.resolve(pathIntent(ap)).state).toBe("allow");
  });
});

describe("PermissionResolver — project overrides global", () => {
  it("mergeFlatPermissions lets a project loosen a global deny", () => {
    const global = { path: { "*.env": "deny" } } as unknown as FlatPermissionConfig;
    const project = { path: { "prod.env": "allow" } } as unknown as FlatPermissionConfig;
    const merged = mergeFlatPermissions(global, project);
    const pathRules = merged.path as Record<string, string>;
    expect(pathRules["prod.env"]).toBe("allow");
    expect(pathRules["*.env"]).toBe("deny");
  });
});
