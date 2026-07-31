import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyPathOperation } from "../src/core/guardrail.ts";

let tmpRoot: string;
let projectVault: string;
let personalVault: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-guard-"));
  projectVault = path.join(tmpRoot, "project", ".llm-wiki");
  personalVault = path.join(tmpRoot, "personal", ".llm-wiki");
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const ALL_VAULTS = () => [projectVault, personalVault];

describe("classifyPathOperation — raw/** is blocked", () => {
  it("blocks a write into raw/sources/<id>/original/", () => {
    const target = path.join(projectVault, "raw", "sources", "SRC-1", "original", "note.md");
    const decision = classifyPathOperation(
      "write",
      { path: target, content: "x" },
      { cwd: tmpRoot, vaultRoots: ALL_VAULTS() },
    );
    expect(decision.block).toBe(true);
    expect(decision.wikiTouched).toBe(false);
    expect(decision.reason).toMatch(/raw/i);
  });

  it("blocks a write to raw/ itself", () => {
    const decision = classifyPathOperation(
      "write",
      { path: path.join(projectVault, "raw"), content: "x" },
      { cwd: tmpRoot, vaultRoots: ALL_VAULTS() },
    );
    expect(decision.block).toBe(true);
  });

  it("blocks an edit into raw/", () => {
    const decision = classifyPathOperation(
      "edit",
      { path: path.join(projectVault, "raw", "sources", "SRC-1", "extracted.md"), edits: [] },
      { cwd: tmpRoot, vaultRoots: ALL_VAULTS() },
    );
    expect(decision.block).toBe(true);
  });

  it("blocks a relative path that resolves into raw/ against cwd", () => {
    const decision = classifyPathOperation(
      "write",
      { path: path.relative(path.join(projectVault, "raw"), path.join(projectVault, "raw", "x.md")), content: "x" },
      { cwd: path.join(projectVault, "raw"), vaultRoots: ALL_VAULTS() },
    );
    expect(decision.block).toBe(true);
  });
});

describe("classifyPathOperation — meta/** is blocked", () => {
  it("blocks a write to meta/registry.json", () => {
    const decision = classifyPathOperation(
      "write",
      { path: path.join(projectVault, "meta", "registry.json"), content: "{}" },
      { cwd: tmpRoot, vaultRoots: ALL_VAULTS() },
    );
    expect(decision.block).toBe(true);
    expect(decision.reason).toMatch(/meta/i);
  });

  it("blocks a write to any file under meta/", () => {
    const decision = classifyPathOperation(
      "write",
      { path: path.join(projectVault, "meta", "deep", "log.md"), content: "x" },
      { cwd: tmpRoot, vaultRoots: ALL_VAULTS() },
    );
    expect(decision.block).toBe(true);
  });
});

describe("classifyPathOperation — wiki/** is allowed and flagged", () => {
  it("allows a write into wiki/ and flags wikiTouched with the vault", () => {
    const decision = classifyPathOperation(
      "write",
      { path: path.join(projectVault, "wiki", "concepts", "foo.md"), content: "# Foo" },
      { cwd: tmpRoot, vaultRoots: ALL_VAULTS() },
    );
    expect(decision.block).toBe(false);
    expect(decision.wikiTouched).toBe(true);
    expect(decision.touchedVault).toBe(projectVault);
  });

  it("flags the personal vault when its wiki/ is touched", () => {
    const decision = classifyPathOperation(
      "write",
      { path: path.join(personalVault, "wiki", "overview.md"), content: "# Overview" },
      { cwd: tmpRoot, vaultRoots: ALL_VAULTS() },
    );
    expect(decision.block).toBe(false);
    expect(decision.wikiTouched).toBe(true);
    expect(decision.touchedVault).toBe(personalVault);
  });

  it("allows an edit into wiki/", () => {
    const decision = classifyPathOperation(
      "edit",
      { path: path.join(projectVault, "wiki", "concepts", "foo.md"), edits: [{ oldText: "a", newText: "b" }] },
      { cwd: tmpRoot, vaultRoots: ALL_VAULTS() },
    );
    expect(decision.block).toBe(false);
    expect(decision.wikiTouched).toBe(true);
  });
});

describe("classifyPathOperation — non-vault and non-path-bearing tools", () => {
  it("allows writes entirely outside any vault without flagging wiki", () => {
    const decision = classifyPathOperation(
      "write",
      { path: path.join(tmpRoot, "elsewhere", "note.md"), content: "x" },
      { cwd: tmpRoot, vaultRoots: ALL_VAULTS() },
    );
    expect(decision.block).toBe(false);
    expect(decision.wikiTouched).toBe(false);
    expect(decision.touchedVault).toBeUndefined();
  });

  it("does not treat a sibling directory named rawish as raw/", () => {
    const decision = classifyPathOperation(
      "write",
      { path: path.join(projectVault, "rawish", "x.md"), content: "x" },
      { cwd: tmpRoot, vaultRoots: ALL_VAULTS() },
    );
    expect(decision.block).toBe(false);
  });

  it("passes through read/grep/ls tools untouched", () => {
    for (const toolName of ["read", "grep", "ls", "bash"] as const) {
      const decision = classifyPathOperation(
        toolName,
        { path: path.join(projectVault, "meta", "registry.json") },
        { cwd: tmpRoot, vaultRoots: ALL_VAULTS() },
      );
      expect(decision.block).toBe(false);
      expect(decision.wikiTouched).toBe(false);
    }
  });

  it("allows when the input has no usable path", () => {
    const decision = classifyPathOperation("write", { content: "x" }, { cwd: tmpRoot, vaultRoots: ALL_VAULTS() });
    expect(decision.block).toBe(false);
    expect(decision.wikiTouched).toBe(false);
  });

  it("allows when input is not a record", () => {
    const decision = classifyPathOperation("write", "garbage", { cwd: tmpRoot, vaultRoots: ALL_VAULTS() });
    expect(decision.block).toBe(false);
  });
});

describe("classifyPathOperation — path traversal", () => {
  it("resolves a ../ escape and still blocks a write into raw/", () => {
    const subdir = path.join(projectVault, "wiki", "concepts");
    const decision = classifyPathOperation(
      "write",
      { path: path.join(subdir, "..", "..", "raw", "x.md"), content: "x" },
      { cwd: subdir, vaultRoots: ALL_VAULTS() },
    );
    expect(decision.block).toBe(true);
  });
});
