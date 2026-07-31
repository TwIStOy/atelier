import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { type DisableConfigPaths, resolveDisabledExtensions } from "../src/extension-disable.ts";

describe("resolveDisabledExtensions", () => {
  let dir: string;
  let globalPath: string;
  let projectPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ext-disable-"));
    globalPath = join(dir, "global.json");
    projectPath = join(dir, "project.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function paths(): DisableConfigPaths {
    return { globalPath, projectPath };
  }

  test("disabled in either file is disabled (union)", () => {
    writeFileSync(globalPath, JSON.stringify({ committer: true }), "utf8");
    writeFileSync(projectPath, JSON.stringify({ "voice-input": true }), "utf8");
    const disabled = resolveDisabledExtensions(paths());
    expect(disabled.has("committer")).toBe(true);
    expect(disabled.has("voice-input")).toBe(true);
  });

  test("missing files disable nothing", () => {
    expect(resolveDisabledExtensions(paths()).size).toBe(0);
  });

  test("only true values count; false is not disabled", () => {
    writeFileSync(globalPath, JSON.stringify({ committer: false, todo: true }), "utf8");
    const disabled = resolveDisabledExtensions(paths());
    expect(disabled.has("todo")).toBe(true);
    expect(disabled.has("committer")).toBe(false);
  });

  test("non-boolean values are ignored", () => {
    writeFileSync(globalPath, JSON.stringify({ todo: "yes", goal: 1, btw: null }), "utf8");
    expect(resolveDisabledExtensions(paths()).size).toBe(0);
  });

  test("malformed JSON is ignored without throwing", () => {
    writeFileSync(globalPath, "{not json", "utf8");
    writeFileSync(projectPath, JSON.stringify({ btw: true }), "utf8");
    const disabled = resolveDisabledExtensions(paths());
    expect(disabled.has("btw")).toBe(true);
    expect(disabled.size).toBe(1);
  });

  test("non-object root (array) is ignored", () => {
    writeFileSync(globalPath, JSON.stringify(["committer"]), "utf8");
    expect(resolveDisabledExtensions(paths()).has("committer")).toBe(false);
  });

  test("project false does not override global true (union, not project-wins)", () => {
    writeFileSync(globalPath, JSON.stringify({ committer: true }), "utf8");
    writeFileSync(projectPath, JSON.stringify({ committer: false }), "utf8");
    expect(resolveDisabledExtensions(paths()).has("committer")).toBe(true);
  });

  test("project can additionally disable beyond global", () => {
    writeFileSync(globalPath, JSON.stringify({ committer: true }), "utf8");
    writeFileSync(projectPath, JSON.stringify({ todo: true }), "utf8");
    const disabled = resolveDisabledExtensions(paths());
    expect(disabled.has("committer")).toBe(true);
    expect(disabled.has("todo")).toBe(true);
  });
});
