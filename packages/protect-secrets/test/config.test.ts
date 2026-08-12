import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getProjectConfigPath, loadProjectConfig, normalizePath, resetProjectConfigCache } from "../src/config.ts";

let root: string;
let cwd: string;

function writeConfig(content: string): void {
  const path = getProjectConfigPath(cwd);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "protect-secrets-test-"));
  cwd = join(root, "project");
  mkdirSync(cwd, { recursive: true });
  resetProjectConfigCache();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("loadProjectConfig", () => {
  test("returns empty result when config is absent", () => {
    const result = loadProjectConfig(cwd);
    expect(result).toEqual({ paths: [], issues: [] });
  });

  test("loads absolute paths", () => {
    writeConfig(JSON.stringify({ protectedPaths: ["/var/secrets", "/etc/vault/"] }));
    const result = loadProjectConfig(cwd);
    expect(result.issues).toEqual([]);
    expect(result.paths).toEqual(["/var/secrets", "/etc/vault"]);
  });

  test("resolves relative paths against the project root", () => {
    writeConfig(JSON.stringify({ protectedPaths: ["secrets", "./keys/private"] }));
    const result = loadProjectConfig(cwd);
    expect(result.paths).toEqual([join(cwd, "secrets"), join(cwd, "keys/private")]);
  });

  test("expands tilde to home directory", () => {
    writeConfig(JSON.stringify({ protectedPaths: ["~/vault/secrets"] }));
    const result = loadProjectConfig(cwd);
    expect(result.paths).toEqual([join(homedir(), "vault/secrets")]);
  });

  test("empty config object yields no paths", () => {
    writeConfig("{}");
    const result = loadProjectConfig(cwd);
    expect(result).toEqual({ paths: [], issues: [] });
  });

  test("invalid JSON produces an issue and no paths", () => {
    writeConfig("{ not json");
    const result = loadProjectConfig(cwd);
    expect(result.paths).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain("Failed to parse config");
  });

  test("non-object config produces an issue", () => {
    writeConfig('["/var/secrets"]');
    const result = loadProjectConfig(cwd);
    expect(result.paths).toEqual([]);
    expect(result.issues[0]).toContain("must be a JSON object");
  });

  test("non-array protectedPaths produces an issue", () => {
    writeConfig(JSON.stringify({ protectedPaths: "/var/secrets" }));
    const result = loadProjectConfig(cwd);
    expect(result.paths).toEqual([]);
    expect(result.issues[0]).toContain("must be an array of strings");
  });

  test("non-string entries are skipped with an issue", () => {
    writeConfig(JSON.stringify({ protectedPaths: ["/var/secrets", 42, ""] }));
    const result = loadProjectConfig(cwd);
    expect(result.paths).toEqual(["/var/secrets"]);
    expect(result.issues).toHaveLength(2);
  });

  test("reloads when the config file changes", () => {
    writeConfig(JSON.stringify({ protectedPaths: ["/first"] }));
    expect(loadProjectConfig(cwd).paths).toEqual(["/first"]);
    writeConfig(JSON.stringify({ protectedPaths: ["/second"] }));
    expect(loadProjectConfig(cwd).paths).toEqual(["/second"]);
  });

  test("discovers config in an ancestor directory and resolves relative paths against it", () => {
    writeConfig(JSON.stringify({ protectedPaths: ["secrets"] }));
    const nested = join(cwd, "sub", "dir");
    mkdirSync(nested, { recursive: true });
    const result = loadProjectConfig(nested);
    expect(result.issues).toEqual([]);
    expect(result.paths).toEqual([join(cwd, "secrets")]);
  });

  test("nearest ancestor config wins", () => {
    writeConfig(JSON.stringify({ protectedPaths: ["/outer"] }));
    const nested = join(cwd, "sub");
    const nestedConfig = getProjectConfigPath(nested);
    mkdirSync(join(nestedConfig, ".."), { recursive: true });
    writeFileSync(nestedConfig, JSON.stringify({ protectedPaths: ["/inner"] }));
    const result = loadProjectConfig(join(nested, "deep"));
    expect(result.paths).toEqual(["/inner"]);
  });
});

describe("normalizePath", () => {
  test("strips trailing slashes", () => {
    expect(normalizePath("/var/secrets/", cwd)).toBe("/var/secrets");
  });

  test("keeps root as-is", () => {
    expect(normalizePath("/", cwd)).toBe("/");
  });

  test("resolves dot segments", () => {
    expect(normalizePath("a/../b", cwd)).toBe(join(cwd, "b"));
  });
});
