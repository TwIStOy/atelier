import { describe, expect, it } from "vitest";

import {
  applyDefaults,
  detectPermissiveBashFallback,
  mergeFlatPermissions,
  mergeUnifiedConfigs,
  stripJsonComments,
  validateUnifiedConfig,
} from "../src/config-loader.ts";
import type { FlatPermissionConfig } from "../src/config-schema.ts";

describe("stripJsonComments", () => {
  it("strips line comments", () => {
    expect(stripJsonComments('{"a": 1 // comment\n}')).toBe('{"a": 1 \n}');
  });

  it("strips block comments", () => {
    expect(stripJsonComments('{"a": /* c */ 1}')).toBe('{"a":  1}');
  });

  it("does not treat // or /* inside a string as a comment", () => {
    expect(stripJsonComments('{"a": "x // y"}')).toBe('{"a": "x // y"}');
    expect(stripJsonComments('{"a": "x /* y */"}')).toBe('{"a": "x /* y */"}');
  });

  it("honors backslash escapes inside strings", () => {
    expect(stripJsonComments('{"a": "x\\" // y"}')).toBe('{"a": "x\\" // y"}');
  });

  it("handles an unterminated block comment by consuming to EOF", () => {
    expect(stripJsonComments('{"a": 1 /* never closed')).toBe('{"a": 1 ');
  });
});

describe("validateUnifiedConfig", () => {
  it("accepts a valid config with a permission map", () => {
    const result = validateUnifiedConfig({
      permission: { "*": "ask", read: "allow", bash: { "git *": "ask" } },
    });
    expect(result.issues).toEqual([]);
    expect(result.config.permission?.read).toBe("allow");
  });

  it("accepts an empty object", () => {
    const result = validateUnifiedConfig({});
    expect(result.issues).toEqual([]);
  });

  it("rejects an unrecognized top-level key", () => {
    const result = validateUnifiedConfig({ bogus: 1 });
    expect(result.issues.some((i) => i.includes("Unrecognized config key 'bogus'"))).toBe(true);
  });

  it("rejects an invalid permission state", () => {
    const result = validateUnifiedConfig({ permission: { "*": "maybe" } });
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("accepts a deny-with-reason object as a pattern value", () => {
    const result = validateUnifiedConfig({
      permission: { bash: { "npm *": { action: "deny", reason: "use pnpm" } } },
    });
    expect(result.issues).toEqual([]);
  });
});

describe("mergeFlatPermissions", () => {
  it("override string replaces base string", () => {
    expect(mergeFlatPermissions({ "*": "ask" }, { "*": "allow" })).toEqual({ "*": "allow" });
  });

  it("two object surfaces merge per-pattern (override wins)", () => {
    const merged = mergeFlatPermissions({ bash: { "*": "ask", "git *": "ask" } }, { bash: { "git status": "allow" } });
    expect(merged.bash).toEqual({ "*": "ask", "git *": "ask", "git status": "allow" });
  });

  it("object override replaces a base string surface", () => {
    const merged = mergeFlatPermissions({ read: "allow" }, { read: { "*.env": "deny" } });
    expect(merged.read).toEqual({ "*.env": "deny" });
  });
});

describe("mergeUnifiedConfigs", () => {
  it("deep-merges the permission map", () => {
    const merged = mergeUnifiedConfigs(
      { permission: { path: { "*.env": "deny" } } },
      { permission: { path: { "prod.env": "allow" } } },
    );
    expect(merged.permission?.path).toEqual({ "*.env": "deny", "prod.env": "allow" });
  });

  it("takes override permission when base has none", () => {
    const merged = mergeUnifiedConfigs({}, { permission: { "*": "ask" } });
    expect(merged.permission?.["*"]).toBe("ask");
  });
});

describe("applyDefaults (dev-friendly defaults)", () => {
  const defaults = applyDefaults({});

  it("reads default to allow", () => {
    expect(defaults.read).toBe("allow");
  });

  it("write/edit/bash default to ask", () => {
    expect(defaults.write).toBe("ask");
    expect(defaults.edit).toBe("ask");
    expect(defaults.bash).toBe("ask");
  });

  it("path denies .env and ~/.ssh/*", () => {
    expect((defaults.path as Record<string, string>)["*.env"]).toBe("deny");
    expect((defaults.path as Record<string, string>)["~/.ssh/*"]).toBe("deny");
  });

  it("an explicit config override wins over the default", () => {
    const withOverride = applyDefaults({ permission: { read: "ask" } });
    expect(withOverride.read).toBe("ask");
  });
});

describe("detectPermissiveBashFallback", () => {
  it("warns when top-level '*' is allow and bash is absent", () => {
    const permission: FlatPermissionConfig = { "*": "allow" };
    const issue = detectPermissiveBashFallback(permission);
    expect(issue).toBeDefined();
    expect(issue).toContain("bash");
    expect(issue).toContain("allow");
  });

  it("warns when top-level '*' is allow and bash map has no '*' key", () => {
    const permission: FlatPermissionConfig = {
      "*": "allow",
      bash: { "git *": "ask" } as Record<string, "ask">,
    };
    expect(detectPermissiveBashFallback(permission)).toBeDefined();
  });

  it("does not warn when bash is a bare string surface", () => {
    const permission: FlatPermissionConfig = { "*": "allow", bash: "ask" };
    expect(detectPermissiveBashFallback(permission)).toBeUndefined();
  });

  it("does not warn when bash map has an explicit '*' key", () => {
    const permission: FlatPermissionConfig = {
      "*": "allow",
      bash: { "*": "ask", "git *": "allow" } as Record<string, "ask" | "allow">,
    };
    expect(detectPermissiveBashFallback(permission)).toBeUndefined();
  });

  it("does not warn when top-level '*' is not allow", () => {
    expect(detectPermissiveBashFallback({ "*": "ask" })).toBeUndefined();
  });

  it("does not warn when top-level '*' is absent", () => {
    expect(detectPermissiveBashFallback({ bash: { "git *": "ask" } })).toBeUndefined();
  });

  it("does not warn when permission is undefined", () => {
    expect(detectPermissiveBashFallback(undefined)).toBeUndefined();
  });
});
