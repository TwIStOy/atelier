import { describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  resolvePackages,
  readPiSnippets,
  readPkgName,
  expandExtensionSubpackages,
  collectSnippetDirs,
} from "./discover.ts";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

let tmpBase: string;

beforeEach(() => {
  tmpBase = mkdtempSync(join(tmpdir(), "snippet-disc-test-"));
});

afterEach(() => {
  rmSync(tmpBase, { recursive: true, force: true });
});

describe("resolvePackages", () => {
  test("absolute path returned as-is", () => {
    const absDir = mkdtempSync(join(tmpdir(), "abs-pkg-"));
    const result = resolvePackages([absDir], tmpBase);
    expect(result).toContain(absDir);
    rmSync(absDir, { recursive: true, force: true });
  });

  test("relative path resolved against baseDir", () => {
    mkdirSync(join(tmpBase, "my-pkg"), { recursive: true });
    const result = resolvePackages(["my-pkg"], tmpBase);
    expect(result).toEqual([join(tmpBase, "my-pkg")]);
  });

  test("non-existent path skipped", () => {
    const result = resolvePackages(["does-not-exist"], tmpBase);
    expect(result).toEqual([]);
  });

  test("non-directory path skipped", () => {
    writeFileSync(join(tmpBase, "a-file.txt"), "hello");
    const result = resolvePackages(["a-file.txt"], tmpBase);
    expect(result).toEqual([]);
  });

  test("deduplicates resolved paths", () => {
    mkdirSync(join(tmpBase, "dup-pkg"), { recursive: true });
    const result = resolvePackages(
      ["dup-pkg", "dup-pkg", join(tmpBase, "dup-pkg")],
      tmpBase,
    );
    expect(result).toEqual([join(tmpBase, "dup-pkg")]);
  });

  test("resolves npm: prefixed entry to <base>/npm/node_modules/<name>", () => {
    const nmDir = join(tmpBase, "npm", "node_modules", "my-pkg");
    mkdirSync(nmDir, { recursive: true });
    const result = resolvePackages(["npm:my-pkg@1.0.0"], tmpBase);
    expect(result).toEqual([nmDir]);
  });

  test("resolves npm: scoped package correctly", () => {
    const nmDir = join(tmpBase, "npm", "node_modules", "@scope", "pkg");
    mkdirSync(nmDir, { recursive: true });
    const result = resolvePackages(["npm:@scope/pkg@2.0.0"], tmpBase);
    expect(result).toEqual([nmDir]);
  });

  test("resolves npm: without version", () => {
    const nmDir = join(tmpBase, "npm", "node_modules", "bare-pkg");
    mkdirSync(nmDir, { recursive: true });
    const result = resolvePackages(["npm:bare-pkg"], tmpBase);
    expect(result).toEqual([nmDir]);
  });

  test("resolves git: prefixed entry to <base>/git/<host>/<path>", () => {
    const gitDir = join(tmpBase, "git", "github.com", "user", "repo");
    mkdirSync(gitDir, { recursive: true });
    const result = resolvePackages(["git:github.com/user/repo@v1"], tmpBase);
    expect(result).toEqual([gitDir]);
  });

  test("resolves git: without ref", () => {
    const gitDir = join(tmpBase, "git", "github.com", "user", "repo");
    mkdirSync(gitDir, { recursive: true });
    const result = resolvePackages(["git:github.com/user/repo"], tmpBase);
    expect(result).toEqual([gitDir]);
  });

  test("skips npm: entry when not installed", () => {
    const result = resolvePackages(["npm:not-installed@1.0.0"], tmpBase);
    expect(result).toEqual([]);
  });

  test("skips git: entry when not installed", () => {
    const result = resolvePackages(["git:github.com/missing/repo@v1"], tmpBase);
    expect(result).toEqual([]);
  });
});

describe("readPiSnippets", () => {
  test("returns array when pi.snippets exists", () => {
    writeFileSync(
      join(tmpBase, "package.json"),
      JSON.stringify({ pi: { snippets: ["./snippets", "./more"] } }),
    );
    expect(readPiSnippets(tmpBase)).toEqual(["./snippets", "./more"]);
  });

  test("returns empty array when no pi manifest", () => {
    writeFileSync(join(tmpBase, "package.json"), JSON.stringify({ name: "x" }));
    expect(readPiSnippets(tmpBase)).toEqual([]);
  });

  test("returns empty array when pi exists but no snippets key", () => {
    writeFileSync(
      join(tmpBase, "package.json"),
      JSON.stringify({ pi: { extensions: ["./index.ts"] } }),
    );
    expect(readPiSnippets(tmpBase)).toEqual([]);
  });

  test("returns empty array when package.json doesn't exist", () => {
    expect(readPiSnippets(join(tmpBase, "nope"))).toEqual([]);
  });
});

describe("readPkgName", () => {
  test("returns name field from package.json", () => {
    writeFileSync(
      join(tmpBase, "package.json"),
      JSON.stringify({ name: "my-cool-pkg" }),
    );
    expect(readPkgName(tmpBase)).toBe("my-cool-pkg");
  });

  test("returns basename when no name field", () => {
    writeFileSync(join(tmpBase, "package.json"), JSON.stringify({}));
    expect(readPkgName(tmpBase)).toBe(tmpBase.split("/").pop()!);
  });

  test("returns basename when no package.json", () => {
    const dirName = tmpBase.split("/").pop()!;
    expect(readPkgName(tmpBase)).toBe(dirName);
  });
});

describe("expandExtensionSubpackages", () => {
  test("returns sub-package dirs when pi.extensions points to directories with package.json", () => {
    mkdirSync(join(tmpBase, "sub"), { recursive: true });
    writeFileSync(join(tmpBase, "sub", "package.json"), JSON.stringify({}));
    writeFileSync(
      join(tmpBase, "package.json"),
      JSON.stringify({ pi: { extensions: ["./sub"] } }),
    );
    const result = expandExtensionSubpackages(tmpBase);
    expect(result).toEqual([join(tmpBase, "sub")]);
  });

  test("skips sub-dirs without package.json", () => {
    mkdirSync(join(tmpBase, "sub"), { recursive: true });
    writeFileSync(
      join(tmpBase, "package.json"),
      JSON.stringify({ pi: { extensions: ["./sub"] } }),
    );
    const result = expandExtensionSubpackages(tmpBase);
    expect(result).toEqual([]);
  });

  test("handles entry pointing to a file (takes dirname)", () => {
    mkdirSync(join(tmpBase, "sub"), { recursive: true });
    writeFileSync(join(tmpBase, "sub", "index.ts"), "");
    writeFileSync(join(tmpBase, "sub", "package.json"), JSON.stringify({}));
    writeFileSync(
      join(tmpBase, "package.json"),
      JSON.stringify({ pi: { extensions: ["./sub/index.ts"] } }),
    );
    const result = expandExtensionSubpackages(tmpBase);
    expect(result).toEqual([join(tmpBase, "sub")]);
  });

  test("returns empty array when no pi.extensions", () => {
    writeFileSync(join(tmpBase, "package.json"), JSON.stringify({}));
    expect(expandExtensionSubpackages(tmpBase)).toEqual([]);
  });
});

describe("collectSnippetDirs", () => {
  test("includes user fixed dir when it exists", () => {
    mkdirSync(join(tmpBase, "agent", "snippets"), { recursive: true });
    const result = collectSnippetDirs(tmpBase, join(tmpBase, "agent"));
    expect(result).toEqual([
      { dir: join(tmpBase, "agent", "snippets"), source: "user" },
    ]);
  });

  test("skips user fixed dir when it doesn't exist", () => {
    const result = collectSnippetDirs(tmpBase, join(tmpBase, "agent"));
    expect(result).toEqual([]);
  });

  test("expands pi.snippets from packages in settings", () => {
    mkdirSync(join(tmpBase, "agent"), { recursive: true });
    mkdirSync(join(tmpBase, "pkg", "snippets"), { recursive: true });
    writeFileSync(
      join(tmpBase, "pkg", "package.json"),
      JSON.stringify({
        name: "my-pkg",
        pi: { snippets: ["./snippets"] },
      }),
    );
    writeFileSync(
      join(tmpBase, "agent", "settings.json"),
      JSON.stringify({ packages: ["../pkg"] }),
    );
    const result = collectSnippetDirs(tmpBase, join(tmpBase, "agent"));
    expect(result).toEqual([
      {
        dir: join(tmpBase, "pkg", "snippets"),
        source: "package:my-pkg",
      },
    ]);
  });

  test("expands sub-packages from pi.extensions of root packages", () => {
    mkdirSync(join(tmpBase, "agent"), { recursive: true });
    mkdirSync(join(tmpBase, "root", "sub", "snippets"), { recursive: true });
    writeFileSync(
      join(tmpBase, "root", "sub", "package.json"),
      JSON.stringify({
        name: "sub-pkg",
        pi: { snippets: ["./snippets"] },
      }),
    );
    writeFileSync(
      join(tmpBase, "root", "package.json"),
      JSON.stringify({
        name: "root-pkg",
        pi: { extensions: ["./sub"] },
      }),
    );
    writeFileSync(
      join(tmpBase, "agent", "settings.json"),
      JSON.stringify({ packages: ["../root"] }),
    );
    const result = collectSnippetDirs(tmpBase, join(tmpBase, "agent"));
    expect(result).toEqual([
      {
        dir: join(tmpBase, "root", "sub", "snippets"),
        source: "package:sub-pkg",
      },
    ]);
  });

  test("project-level entries come after user-level (higher priority)", () => {
    mkdirSync(join(tmpBase, "agent", "snippets"), { recursive: true });
    mkdirSync(join(tmpBase, "project", ".pi", "snippets"), { recursive: true });
    const result = collectSnippetDirs(
      join(tmpBase, "project"),
      join(tmpBase, "agent"),
    );
    expect(result).toEqual([
      { dir: join(tmpBase, "agent", "snippets"), source: "user" },
      { dir: join(tmpBase, "project", ".pi", "snippets"), source: "project" },
    ]);
    expect(result[0].source).toBe("user");
    expect(result[1].source).toBe("project");
  });

  test("skips snippet entries pointing to non-existent dirs", () => {
    mkdirSync(join(tmpBase, "agent"), { recursive: true });
    mkdirSync(join(tmpBase, "pkg"), { recursive: true });
    writeFileSync(
      join(tmpBase, "pkg", "package.json"),
      JSON.stringify({
        name: "my-pkg",
        pi: { snippets: ["./nonexistent"] },
      }),
    );
    writeFileSync(
      join(tmpBase, "agent", "settings.json"),
      JSON.stringify({ packages: ["../pkg"] }),
    );
    const result = collectSnippetDirs(tmpBase, join(tmpBase, "agent"));
    expect(result).toEqual([]);
  });
});
