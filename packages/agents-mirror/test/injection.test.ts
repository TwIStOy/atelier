import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InjectionCache } from "../src/cache.ts";
import { injectDirectoryContext } from "../src/injection.ts";

const FILE_NAMES = ["AGENTS.md"];

interface Tree {
  root: string;
  project: string;
  mirror: string;
}

function makeTree(): Tree {
  const root = mkdtempSync(join(tmpdir(), "am-inj-"));
  const project = join(root, "project");
  const mirror = join(root, "mirror");
  mkdirSync(join(project, "src", "components"), { recursive: true });
  mkdirSync(join(mirror, "src", "components"), { recursive: true });
  return { root, project, mirror };
}

function writeAgents(dir: string, content: string): void {
  writeFileSync(join(dir, "AGENTS.md"), content, "utf8");
}

function touch(dir: string, rel: string): void {
  writeFileSync(join(dir, rel), "x", "utf8");
}

describe("injectDirectoryContext", () => {
  let tree: Tree;

  beforeEach(() => {
    tree = makeTree();
  });

  afterEach(() => {
    rmSync(tree.root, { recursive: true, force: true });
  });

  it("injects project nested agents.md outermost-first, skipping the project root", async () => {
    writeAgents(tree.project, "PROJECT_ROOT_SKIP");
    writeAgents(join(tree.project, "src"), "PROJECT_SRC");
    writeAgents(join(tree.project, "src", "components"), "PROJECT_COMP");
    touch(join(tree.project, "src", "components"), "Button.tsx");

    const cache = new InjectionCache();
    const result = await injectDirectoryContext({
      filePath: join(tree.project, "src", "components", "Button.tsx"),
      projectRoot: tree.project,
      mirrorRoot: null,
      cache,
      sessionKey: "s1",
      fileNames: FILE_NAMES,
    });

    expect(result.injectedText).not.toContain("PROJECT_ROOT_SKIP");
    expect(result.injectedFiles.map((f) => f.source)).toEqual(["project", "project"]);
    expect(result.injectedFiles.map((f) => f.absolutePath)).toEqual([
      join(tree.project, "src", "AGENTS.md"),
      join(tree.project, "src", "components", "AGENTS.md"),
    ]);
  });

  it("injects mirror nested agents.md, skipping the mirror root", async () => {
    writeAgents(tree.mirror, "MIRROR_ROOT_SKIP");
    writeAgents(join(tree.mirror, "src"), "MIRROR_SRC");
    writeAgents(join(tree.mirror, "src", "components"), "MIRROR_COMP");
    touch(join(tree.project, "src", "components"), "Button.tsx");

    const cache = new InjectionCache();
    const result = await injectDirectoryContext({
      filePath: join(tree.project, "src", "components", "Button.tsx"),
      projectRoot: tree.project,
      mirrorRoot: tree.mirror,
      cache,
      sessionKey: "s1",
      fileNames: FILE_NAMES,
    });

    expect(result.injectedText).not.toContain("MIRROR_ROOT_SKIP");
    const mirrorFiles = result.injectedFiles.filter((f) => f.source === "mirror");
    expect(mirrorFiles.map((f) => f.absolutePath)).toEqual([
      join(tree.mirror, "src", "AGENTS.md"),
      join(tree.mirror, "src", "components", "AGENTS.md"),
    ]);
  });

  it("combines project then mirror, each outermost-first", async () => {
    writeAgents(join(tree.project, "src"), "PROJECT_SRC");
    writeAgents(join(tree.project, "src", "components"), "PROJECT_COMP");
    writeAgents(join(tree.mirror, "src"), "MIRROR_SRC");
    writeAgents(join(tree.mirror, "src", "components"), "MIRROR_COMP");
    touch(join(tree.project, "src", "components"), "Button.tsx");

    const cache = new InjectionCache();
    const result = await injectDirectoryContext({
      filePath: join(tree.project, "src", "components", "Button.tsx"),
      projectRoot: tree.project,
      mirrorRoot: tree.mirror,
      cache,
      sessionKey: "s1",
      fileNames: FILE_NAMES,
    });

    expect(result.injectedFiles.map((f) => f.absolutePath)).toEqual([
      join(tree.project, "src", "AGENTS.md"),
      join(tree.project, "src", "components", "AGENTS.md"),
      join(tree.mirror, "src", "AGENTS.md"),
      join(tree.mirror, "src", "components", "AGENTS.md"),
    ]);
  });

  it("deduplicates per session across multiple reads in the same directory", async () => {
    writeAgents(join(tree.project, "src"), "PROJECT_SRC");
    touch(join(tree.project, "src", "components"), "Button.tsx");
    touch(join(tree.project, "src", "components"), "Icon.tsx");

    const cache = new InjectionCache();
    const first = await injectDirectoryContext({
      filePath: join(tree.project, "src", "components", "Button.tsx"),
      projectRoot: tree.project,
      mirrorRoot: null,
      cache,
      sessionKey: "s1",
      fileNames: FILE_NAMES,
    });
    const second = await injectDirectoryContext({
      filePath: join(tree.project, "src", "components", "Icon.tsx"),
      projectRoot: tree.project,
      mirrorRoot: null,
      cache,
      sessionKey: "s1",
      fileNames: FILE_NAMES,
    });

    expect(first.injectedFiles).toHaveLength(1);
    expect(second.injectedFiles).toHaveLength(0);
  });

  it("returns nothing for a file outside the project root", async () => {
    const outside = mkdtempSync(join(tmpdir(), "am-out-"));
    try {
      writeAgents(join(tree.project, "src"), "PROJECT_SRC");
      touch(outside, "stranger.txt");
      const cache = new InjectionCache();
      const result = await injectDirectoryContext({
        filePath: join(outside, "stranger.txt"),
        projectRoot: tree.project,
        mirrorRoot: null,
        cache,
        sessionKey: "s1",
        fileNames: FILE_NAMES,
      });
      expect(result.injectedText).toBe("");
      expect(result.injectedFiles).toHaveLength(0);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("respects the per-read byte budget by truncating later files", async () => {
    writeAgents(join(tree.project, "src"), "A".repeat(20));
    writeAgents(join(tree.project, "src", "components"), "B".repeat(20));
    touch(join(tree.project, "src", "components"), "Button.tsx");

    const cache = new InjectionCache();
    const result = await injectDirectoryContext({
      filePath: join(tree.project, "src", "components", "Button.tsx"),
      projectRoot: tree.project,
      mirrorRoot: null,
      cache,
      sessionKey: "s1",
      fileNames: FILE_NAMES,
      maxBytesPerFile: 50,
      maxBytesPerRead: 30,
    });

    const truncated = result.injectedFiles.filter((f) => f.truncated);
    expect(truncated.length).toBeGreaterThan(0);
  });

  it("rejects a symlink that escapes the project root", async () => {
    const escapeDir = mkdtempSync(join(tmpdir(), "am-esc-"));
    try {
      writeAgents(join(tree.project, "src"), "PROJECT_SRC");
      writeAgents(escapeDir, "ESCAPED");
      symlinkSync(escapeDir, join(tree.project, "src", "components", "linked.tsx"));
      const cache = new InjectionCache();
      const result = await injectDirectoryContext({
        filePath: join(tree.project, "src", "components", "linked.tsx"),
        projectRoot: tree.project,
        mirrorRoot: null,
        cache,
        sessionKey: "s1",
        fileNames: FILE_NAMES,
      });
      expect(result.injectedText).not.toContain("ESCAPED");
    } finally {
      rmSync(escapeDir, { recursive: true, force: true });
    }
  });

  it("ignores a non-existent mirror root", async () => {
    writeAgents(join(tree.project, "src"), "PROJECT_SRC");
    touch(join(tree.project, "src", "components"), "Button.tsx");
    const cache = new InjectionCache();
    const result = await injectDirectoryContext({
      filePath: join(tree.project, "src", "components", "Button.tsx"),
      projectRoot: tree.project,
      mirrorRoot: join(tree.mirror, "does-not-exist"),
      cache,
      sessionKey: "s1",
      fileNames: FILE_NAMES,
    });
    expect(result.injectedFiles.every((f) => f.source === "project")).toBe(true);
  });
});
