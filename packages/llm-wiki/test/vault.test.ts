import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultPersonalVaultPath, resolveVaults } from "../src/core/vault.ts";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-vault-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function mkdirp(p: string): string {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

describe("defaultPersonalVaultPath", () => {
  it("is <homedir>/.llm-wiki", () => {
    expect(defaultPersonalVaultPath("/home/user")).toBe(path.join("/home/user", ".llm-wiki"));
  });
});

describe("resolveVaults", () => {
  it("returns null project vault and the default personal vault when nothing is found", () => {
    const cwd = mkdirp(path.join(tmpRoot, "proj"));
    const resolved = resolveVaults({ cwd, personalVaultPath: "/home/me/.llm-wiki" });

    expect(resolved.projectVault).toBeNull();
    expect(resolved.personalVault).toBe("/home/me/.llm-wiki");
  });

  it("discovers a .llm-wiki in the cwd itself", () => {
    const cwd = mkdirp(path.join(tmpRoot, "proj"));
    const expected = mkdirp(path.join(cwd, ".llm-wiki"));

    const resolved = resolveVaults({ cwd, personalVaultPath: "/home/me/.llm-wiki" });

    expect(resolved.projectVault).toBe(expected);
  });

  it("walks up to the nearest ancestor containing .llm-wiki", () => {
    const root = mkdirp(path.join(tmpRoot, "repo"));
    const ancestorVault = mkdirp(path.join(root, ".llm-wiki"));
    const cwd = mkdirp(path.join(root, "a", "b", "c"));

    const resolved = resolveVaults({ cwd, personalVaultPath: "/home/me/.llm-wiki" });

    expect(resolved.projectVault).toBe(ancestorVault);
  });

  it("prefers the nearest vault when several ancestors have one", () => {
    const root = mkdirp(path.join(tmpRoot, "repo"));
    mkdirp(path.join(root, ".llm-wiki"));
    const cwd = mkdirp(path.join(root, "a", "b", "c"));
    const nearest = mkdirp(path.join(root, "a", "b", ".llm-wiki"));

    const resolved = resolveVaults({ cwd, personalVaultPath: "/home/me/.llm-wiki" });

    expect(resolved.projectVault).toBe(nearest);
  });

  it("uses the default personal vault path when no override is given", () => {
    const cwd = mkdirp(path.join(tmpRoot, "proj"));
    const resolved = resolveVaults({ cwd });

    expect(resolved.personalVault).toBe(defaultPersonalVaultPath());
  });
});
