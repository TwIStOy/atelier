import * as assert from "node:assert/strict";
import { describe, it } from "vitest";
import { PARAM_NAME_ALIASES, paramNameRepair } from "../src/strategies/param-name-repair.ts";

describe("paramNameRepair", () => {
  it("is a no-op for tools not in the alias table", () => {
    const input: Record<string, unknown> = { command: "ls" };
    const result = paramNameRepair.apply("definitely_not_a_tool", input);
    assert.equal(result.applied, false);
    assert.deepEqual(input, { command: "ls" });
  });

  it("is a no-op when no alias key is present", () => {
    const input: Record<string, unknown> = { path: "/tmp/a", offset: 1 };
    const result = paramNameRepair.apply("read", input);
    assert.equal(result.applied, false);
    assert.deepEqual(input, { path: "/tmp/a", offset: 1 });
  });

  it("renames a single alias to the correct name and preserves the value", () => {
    const input: Record<string, unknown> = { file_path: "/tmp/a" };
    const result = paramNameRepair.apply("read", input);
    assert.equal(result.applied, true);
    assert.equal(result.note, "renamed file_path->path");
    assert.deepEqual(input, { path: "/tmp/a" });
  });

  it("preserves non-string values verbatim", () => {
    const payload = { lines: [1, 2, 3] };
    const input: Record<string, unknown> = { absolutePath: payload };
    paramNameRepair.apply("read", input);
    assert.deepEqual(input, { path: payload });
  });

  it("does not clobber when the correct key is already present", () => {
    const input: Record<string, unknown> = { path: "/correct", file_path: "/wrong" };
    const result = paramNameRepair.apply("read", input);
    assert.equal(result.applied, false);
    assert.deepEqual(input, { path: "/correct", file_path: "/wrong" });
  });

  it("lets the first matching alias win and leaves other aliases untouched", () => {
    const input: Record<string, unknown> = { file_path: "/first", filePath: "/second" };
    const result = paramNameRepair.apply("read", input);
    assert.equal(result.applied, true);
    assert.equal(result.note, "renamed file_path->path");
    assert.deepEqual(input, { path: "/first", filePath: "/second" });
  });

  it("renames multiple params in one call", () => {
    const input: Record<string, unknown> = { file_path: "/a", contents: "body" };
    const result = paramNameRepair.apply("write", input);
    assert.equal(result.applied, true);
    assert.deepEqual(input, { path: "/a", content: "body" });
    assert.ok(result.note?.includes("file_path->path"));
    assert.ok(result.note?.includes("contents->content"));
  });

  it("applies the documented builtin->effective grep glob->include rename", () => {
    const input: Record<string, unknown> = { pattern: "foo", glob: "*.ts" };
    const result = paramNameRepair.apply("grep", input);
    assert.equal(result.applied, true);
    assert.deepEqual(input, { pattern: "foo", include: "*.ts" });
  });

  it("renames grep pattern aliases (query->pattern)", () => {
    const input: Record<string, unknown> = { query: "foo", include: "*.ts" };
    const result = paramNameRepair.apply("grep", input);
    assert.equal(result.applied, true);
    assert.deepEqual(input, { pattern: "foo", include: "*.ts" });
  });

  it("renames ls directory aliases (directory->path)", () => {
    const input: Record<string, unknown> = { directory: "/x" };
    const result = paramNameRepair.apply("ls", input);
    assert.equal(result.applied, true);
    assert.deepEqual(input, { path: "/x" });
  });

  it("renames bash command aliases (shell->command)", () => {
    const input: Record<string, unknown> = { shell: "ls -la" };
    const result = paramNameRepair.apply("bash", input);
    assert.equal(result.applied, true);
    assert.deepEqual(input, { command: "ls -la" });
  });

  it("read.path includes the documented seed aliases", () => {
    const pathAliases = PARAM_NAME_ALIASES.read?.path ?? [];
    for (const a of ["file_path", "filePath", "absolutePath", "file", "target_file", "pathname"]) {
      assert.ok(pathAliases.includes(a), `read.path missing ${a}`);
    }
  });

  it("does not expose top-level edit oldText/newText aliases (our edit uses edits[])", () => {
    const editAliases = PARAM_NAME_ALIASES.edit ?? {};
    assert.ok(!("oldText" in editAliases));
    assert.ok(!("newText" in editAliases));
  });

  it("does not alias the shadowed find tool (not registered in this setup)", () => {
    assert.equal(PARAM_NAME_ALIASES.find, undefined);
  });

  it("renames glob directory aliases (directory->path)", () => {
    const input: Record<string, unknown> = { directory: "/x", pattern: "*.ts" };
    const result = paramNameRepair.apply("glob", input);
    assert.equal(result.applied, true);
    assert.deepEqual(input, { path: "/x", pattern: "*.ts" });
  });

  it("renames glob pattern aliases (query->pattern)", () => {
    const input: Record<string, unknown> = { query: "*.ts", path: "/x" };
    const result = paramNameRepair.apply("glob", input);
    assert.equal(result.applied, true);
    assert.deepEqual(input, { pattern: "*.ts", path: "/x" });
  });

  it("glob is covered, find is not (effective file-find tool is glob)", () => {
    assert.ok(PARAM_NAME_ALIASES.glob, "glob must have an alias entry");
    assert.equal(PARAM_NAME_ALIASES.find, undefined);
  });
});
