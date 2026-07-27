import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { detectRuntime, fingerprint } from "../src/components/runtime.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "pi-runtime-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("detectRuntime", () => {
  test("detects node from package.json", () => {
    writeFileSync(path.join(dir, "package.json"), "{}");
    expect(detectRuntime(dir)).toBe("node");
  });

  test("detects rust from Cargo.toml", () => {
    writeFileSync(path.join(dir, "Cargo.toml"), "");
    expect(detectRuntime(dir)).toBe("rust");
  });

  test("detects go from go.mod", () => {
    writeFileSync(path.join(dir, "go.mod"), "module x");
    expect(detectRuntime(dir)).toBe("go");
  });

  test("returns null when no manifest is present", () => {
    expect(detectRuntime(dir)).toBeNull();
  });

  test("prefers earlier-listed runtime on ambiguous manifests", () => {
    // node is listed before python; both present -> node wins.
    writeFileSync(path.join(dir, "package.json"), "{}");
    writeFileSync(path.join(dir, "requirements.txt"), "");
    expect(detectRuntime(dir)).toBe("node");
  });
});

describe("fingerprint", () => {
  test("changes when a manifest is added", () => {
    const before = fingerprint(dir);
    writeFileSync(path.join(dir, "package.json"), "{}");
    const after = fingerprint(dir);
    expect(before).not.toBe(after);
    expect(after).toContain("package.json");
  });

  test("is stable across repeated calls with no changes", () => {
    writeFileSync(path.join(dir, "Cargo.toml"), "");
    expect(fingerprint(dir)).toBe(fingerprint(dir));
  });
});
