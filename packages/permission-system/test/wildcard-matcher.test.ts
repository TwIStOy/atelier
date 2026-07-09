import { afterEach, describe, expect, test, vi } from "vitest";

const mockHomedir = vi.hoisted(() => vi.fn(() => "/home/testuser"));

vi.mock("node:os", () => ({
  homedir: mockHomedir,
  default: { homedir: mockHomedir },
}));

import {
  compileWildcardPattern,
  compileWildcardPatternEntries,
  findCompiledWildcardMatch,
  findCompiledWildcardMatchForNames,
  wildcardMatch,
} from "../src/wildcard-matcher.ts";

afterEach(() => {
  mockHomedir.mockClear();
  vi.restoreAllMocks();
});

describe("compileWildcardPatternEntries", () => {
  test("returns empty array for empty iterable", () => {
    const result = compileWildcardPatternEntries([]);
    expect(result).toEqual([]);
  });

  test("compiles a single exact pattern", () => {
    const result = compileWildcardPatternEntries([["read", "allow"]]);
    expect(result).toHaveLength(1);
    expect(result[0]?.pattern).toBe("read");
    expect(result[0]?.state).toBe("allow");
  });

  test("compiles multiple patterns in order", () => {
    const entries: [string, string][] = [
      ["read", "allow"],
      ["write", "deny"],
      ["bash *", "ask"],
    ];
    const result = compileWildcardPatternEntries(entries);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.pattern)).toEqual(["read", "write", "bash *"]);
  });
});

describe("findCompiledWildcardMatch", () => {
  test("returns null for empty patterns array", () => {
    const result = findCompiledWildcardMatch([], "read");
    expect(result).toBeNull();
  });

  test("matches exact pattern", () => {
    const patterns = compileWildcardPatternEntries([["read", "allow"]]);
    const result = findCompiledWildcardMatch(patterns, "read");
    expect(result).not.toBeNull();
    expect(result?.state).toBe("allow");
    expect(result?.matchedPattern).toBe("read");
    expect(result?.matchedName).toBe("read");
  });

  test("returns null when no pattern matches", () => {
    const patterns = compileWildcardPatternEntries([["read", "allow"]]);
    const result = findCompiledWildcardMatch(patterns, "write");
    expect(result).toBeNull();
  });

  test("matches glob * pattern", () => {
    const patterns = compileWildcardPatternEntries([["git *", "allow"]]);
    const result = findCompiledWildcardMatch(patterns, "git status");
    expect(result).not.toBeNull();
    expect(result?.state).toBe("allow");
    expect(result?.matchedPattern).toBe("git *");
  });

  test("glob * matches zero or more characters", () => {
    const patterns = compileWildcardPatternEntries([["git*", "allow"]]);
    expect(findCompiledWildcardMatch(patterns, "git")).not.toBeNull();
    expect(findCompiledWildcardMatch(patterns, "git status")).not.toBeNull();
    expect(findCompiledWildcardMatch(patterns, "npm install")).toBeNull();
  });

  test("last-match-wins precedence: later pattern overrides earlier", () => {
    const patterns = compileWildcardPatternEntries([
      ["git *", "allow"],
      ["git push *", "deny"],
    ]);
    const result = findCompiledWildcardMatch(patterns, "git push origin main");
    expect(result).not.toBeNull();
    expect(result?.state).toBe("deny");
    expect(result?.matchedPattern).toBe("git push *");
  });

  test("last-match-wins: specific deny before broad allow matches the later one", () => {
    const patterns = compileWildcardPatternEntries([
      ["*", "deny"],
      ["git status", "allow"],
    ]);
    const result = findCompiledWildcardMatch(patterns, "git status");
    expect(result).not.toBeNull();
    expect(result?.state).toBe("allow");
  });

  test("exact pattern does not match partial name", () => {
    const patterns = compileWildcardPatternEntries([["read", "allow"]]);
    expect(findCompiledWildcardMatch(patterns, "readwrite")).toBeNull();
    expect(findCompiledWildcardMatch(patterns, "readl")).toBeNull();
  });
});

describe("wildcardMatch", () => {
  test("exact match", () => {
    expect(wildcardMatch("read", "read")).toBe(true);
    expect(wildcardMatch("read", "write")).toBe(false);
  });

  test("trailing * matches suffix", () => {
    expect(wildcardMatch("git *", "git push")).toBe(true);
    expect(wildcardMatch("git *", "git")).toBe(true);
    expect(wildcardMatch("git *", "npm install")).toBe(false);
  });

  test("leading * matches prefix", () => {
    expect(wildcardMatch("*.env", ".env")).toBe(true);
    expect(wildcardMatch("*.env", "prod.env")).toBe(true);
    expect(wildcardMatch("*.env", ".envrc")).toBe(false);
  });

  test("? matches exactly one character", () => {
    expect(wildcardMatch("file?.txt", "file1.txt")).toBe(true);
    expect(wildcardMatch("file?.txt", "file12.txt")).toBe(false);
    expect(wildcardMatch("file?.txt", "file.txt")).toBe(false);
  });

  test("middle * matches substring", () => {
    expect(wildcardMatch("a*c", "abc")).toBe(true);
    expect(wildcardMatch("a*c", "ac")).toBe(true);
    expect(wildcardMatch("a*c", "abx")).toBe(false);
  });

  test("escaped regex metacharacters are literal", () => {
    expect(wildcardMatch("file.txt", "file.txt")).toBe(true);
    expect(wildcardMatch("file.txt", "fileXtxt")).toBe(false);
    expect(wildcardMatch("[env]", "[env]")).toBe(true);
    expect(wildcardMatch("(group)", "(group)")).toBe(true);
  });

  test("dotall: * spans newlines", () => {
    expect(wildcardMatch("a*b", "a\nb")).toBe(true);
  });

  test("home expansion: ~/ pattern matches homedir", () => {
    // mockHomedir returns /home/testuser
    expect(wildcardMatch("~/.ssh/*", "/home/testuser/.ssh/config")).toBe(true);
    expect(wildcardMatch("~/.ssh/*", "/other/.ssh/config")).toBe(false);
  });
});

describe("findCompiledWildcardMatchForNames", () => {
  test("returns null for empty names", () => {
    const patterns = compileWildcardPatternEntries([["read", "allow"]]);
    expect(findCompiledWildcardMatchForNames(patterns, [])).toBeNull();
    expect(findCompiledWildcardMatchForNames(patterns, ["  "])).toBeNull();
  });

  test("returns first matching name", () => {
    const patterns = compileWildcardPatternEntries([
      ["read", "allow"],
      ["write", "deny"],
    ]);
    const result = findCompiledWildcardMatchForNames(patterns, ["missing", "write"]);
    expect(result?.state).toBe("deny");
    expect(result?.matchedName).toBe("write");
  });

  test("trims whitespace before matching", () => {
    const patterns = compileWildcardPatternEntries([["read", "allow"]]);
    const result = findCompiledWildcardMatchForNames(patterns, ["  read  "]);
    expect(result?.matchedName).toBe("read");
  });
});

describe("compileWildcardPattern — windows options", () => {
  test("windowsSeparators rewrites / to \\", () => {
    const p = compileWildcardPattern("src/*", "allow", {
      windowsSeparators: true,
    });
    expect(p.regex.test("src\\file")).toBe(true);
    expect(p.regex.test("src/file")).toBe(false);
  });

  test("caseInsensitive adds i flag", () => {
    const p = compileWildcardPattern("Read", "allow", {
      caseInsensitive: true,
    });
    expect(p.regex.test("READ")).toBe(true);
    expect(p.regex.test("read")).toBe(true);
  });
});
