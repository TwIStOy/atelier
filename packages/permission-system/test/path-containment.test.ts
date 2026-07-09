import { describe, expect, test, vi } from "vitest";

const realpathSync = vi.hoisted(() => vi.fn<(path: string) => string>((p) => p));
vi.mock("node:fs", () => ({
  realpathSync,
  default: { realpathSync },
}));

import { isPathOutsideWorkingDirectory, isPathWithinDirectory } from "../src/path-containment.ts";

describe("isPathWithinDirectory", () => {
  test("returns true when path equals directory", () => {
    expect(isPathWithinDirectory("/a/b", "/a/b", "linux")).toBe(true);
  });

  test("returns true when path is a direct child", () => {
    expect(isPathWithinDirectory("/a/b/c", "/a/b", "linux")).toBe(true);
  });

  test("returns true when path is a deep descendant", () => {
    expect(isPathWithinDirectory("/a/b/c/d/e", "/a/b", "linux")).toBe(true);
  });

  test("returns false when path is a sibling directory", () => {
    expect(isPathWithinDirectory("/a/bc", "/a/b", "linux")).toBe(false);
  });

  test("returns false when path is outside the directory", () => {
    expect(isPathWithinDirectory("/other/path", "/a/b", "linux")).toBe(false);
  });

  test("returns false for empty path", () => {
    expect(isPathWithinDirectory("", "/a/b", "linux")).toBe(false);
  });

  test("returns false for empty directory", () => {
    expect(isPathWithinDirectory("/a/b", "", "linux")).toBe(false);
  });

  test("win32: folds case for a case-different descendant", () => {
    expect(isPathWithinDirectory("c:\\users\\foo\\dir\\sub\\x.md", "C:\\Users\\Foo\\dir", "win32")).toBe(true);
  });

  test("win32: folds case when path equals directory in different case", () => {
    expect(isPathWithinDirectory("c:\\users\\foo\\dir\\sub", "C:\\USERS\\foo\\DIR", "win32")).toBe(true);
  });

  test("win32: rejects a sibling directory", () => {
    expect(isPathWithinDirectory("C:\\Users\\Foo\\other", "C:\\Users\\Foo\\dir", "win32")).toBe(false);
  });

  test("posix platform stays case-sensitive", () => {
    expect(isPathWithinDirectory("/a/B/c", "/a/b", "linux")).toBe(false);
  });
});

describe("isPathOutsideWorkingDirectory", () => {
  const canonicalCwd = "/projects/my-app";

  test("does not canonicalize its operands (no filesystem access)", () => {
    realpathSync.mockClear();
    isPathOutsideWorkingDirectory("/projects/my-app/src", canonicalCwd, "linux");
    expect(realpathSync).not.toHaveBeenCalled();
  });

  test("returns false when path is inside cwd", () => {
    expect(isPathOutsideWorkingDirectory("/projects/my-app/src", canonicalCwd, "linux")).toBe(false);
  });

  test("returns false when path equals cwd", () => {
    expect(isPathOutsideWorkingDirectory("/projects/my-app", canonicalCwd, "linux")).toBe(false);
  });

  test("returns true when path is outside cwd", () => {
    expect(isPathOutsideWorkingDirectory("/etc/passwd", canonicalCwd, "linux")).toBe(true);
  });

  test("returns false for an empty canonical path", () => {
    expect(isPathOutsideWorkingDirectory("", canonicalCwd, "linux")).toBe(false);
  });

  test("returns false for an empty canonical cwd", () => {
    expect(isPathOutsideWorkingDirectory("/etc/passwd", "", "linux")).toBe(false);
  });

  test("returns false for /dev/null (safe system path)", () => {
    expect(isPathOutsideWorkingDirectory("/dev/null", canonicalCwd, "linux")).toBe(false);
  });

  test("returns false for /dev/stdin (safe system path)", () => {
    expect(isPathOutsideWorkingDirectory("/dev/stdin", canonicalCwd, "linux")).toBe(false);
  });

  test("returns false for /dev/stdout (safe system path)", () => {
    expect(isPathOutsideWorkingDirectory("/dev/stdout", canonicalCwd, "linux")).toBe(false);
  });

  test("returns false for /dev/stderr (safe system path)", () => {
    expect(isPathOutsideWorkingDirectory("/dev/stderr", canonicalCwd, "linux")).toBe(false);
  });

  test("returns true for /dev/null/subdir (not a safe path)", () => {
    expect(isPathOutsideWorkingDirectory("/dev/null/subdir", canonicalCwd, "linux")).toBe(true);
  });
});
