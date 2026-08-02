import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapVault } from "../src/core/bootstrap.ts";
import { initGitRepo } from "../src/core/git.ts";

let tmpRoot: string;
let vaultRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-git-"));
  vaultRoot = path.join(tmpRoot, "vault");
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: vaultRoot, encoding: "utf8" }).trim();
}

describe("initGitRepo — fresh repo", () => {
  it("creates a .git dir and a baseline commit on the main branch", () => {
    bootstrapVault(vaultRoot);
    const result = initGitRepo(vaultRoot);

    expect(result.initialized).toBe(true);
    expect(result.committed).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, ".git"))).toBe(true);
    expect(result.commitSha).toMatch(/^[0-9a-f]{7,40}$/);
    expect(git(["symbolic-ref", "--short", "HEAD"])).toBe("main");
    expect(git(["log", "-1", "--pretty=%s"])).toBe("Initial wiki vault");
    expect(git(["rev-parse", "HEAD"])).toBe(result.commitSha);
  });

  it("hardens local config: gpgsign off, tag.gpgsign off, ssh strips the agent, neutral identity", () => {
    bootstrapVault(vaultRoot);
    initGitRepo(vaultRoot);

    expect(git(["config", "--local", "commit.gpgsign"])).toBe("false");
    expect(git(["config", "--local", "tag.gpgsign"])).toBe("false");
    expect(git(["config", "--local", "core.sshCommand"])).toBe("env -u SSH_AUTH_SOCK ssh");
    expect(git(["config", "--local", "user.name"])).toBe("LLM Wiki");
    expect(git(["config", "--local", "user.email"])).toBe("llm-wiki@local");
  });

  it("writes a .gitignore covering OS junk and atomic-write tmp leftovers", () => {
    bootstrapVault(vaultRoot);
    initGitRepo(vaultRoot);

    const body = fs.readFileSync(path.join(vaultRoot, ".gitignore"), "utf8");
    expect(body).toContain(".DS_Store");
    expect(body).toContain("*.tmp");
  });

  it("commits the whole scaffold (incl. meta/) so the working tree is clean", () => {
    bootstrapVault(vaultRoot);
    initGitRepo(vaultRoot);

    expect(git(["status", "--porcelain"])).toBe("");

    const tracked = git(["ls-files"]);
    expect(tracked).toContain("meta/registry.json");
    expect(tracked).toContain("meta/events.jsonl");
    expect(tracked).toContain("WIKI_SCHEMA.md");
    expect(tracked).toContain(".gitignore");
  });

  it("honours caller-supplied identity, branch, and commit message", () => {
    bootstrapVault(vaultRoot);
    initGitRepo(vaultRoot, {
      committerName: "Wiki Bot",
      committerEmail: "bot@example.com",
      defaultBranch: "trunk",
      initialCommitMessage: "seed vault",
    });

    expect(git(["symbolic-ref", "--short", "HEAD"])).toBe("trunk");
    expect(git(["config", "--local", "user.name"])).toBe("Wiki Bot");
    expect(git(["config", "--local", "user.email"])).toBe("bot@example.com");
    expect(git(["log", "-1", "--pretty=%s"])).toBe("seed vault");
  });
});

describe("initGitRepo — idempotent", () => {
  it("does not create a second commit on re-run, but re-applies drifted config", () => {
    bootstrapVault(vaultRoot);
    const first = initGitRepo(vaultRoot);
    const firstSha = first.commitSha!;

    git(["config", "--local", "commit.gpgsign", "true"]);

    const second = initGitRepo(vaultRoot);
    expect(second.initialized).toBe(false);
    expect(second.committed).toBe(false);
    expect(second.commitSha).toBeUndefined();
    expect(git(["rev-parse", "HEAD"])).toBe(firstSha);
    expect(git(["config", "--local", "commit.gpgsign"])).toBe("false");
  });

  it("leaves a pre-existing .gitignore untouched", () => {
    bootstrapVault(vaultRoot);
    fs.writeFileSync(path.join(vaultRoot, ".gitignore"), "custom-rule\n", "utf8");

    initGitRepo(vaultRoot);

    expect(fs.readFileSync(path.join(vaultRoot, ".gitignore"), "utf8")).toBe("custom-rule\n");
  });

  it("still bootstraps git for a vault created before this feature (no .git yet)", () => {
    bootstrapVault(vaultRoot);
    expect(fs.existsSync(path.join(vaultRoot, ".git"))).toBe(false);

    const result = initGitRepo(vaultRoot);
    expect(result.initialized).toBe(true);
    expect(result.committed).toBe(true);
  });
});

describe("initGitRepo — bare directory (no vault scaffold)", () => {
  it("still initializes the repo, hardens config, and commits the .gitignore it created", () => {
    fs.mkdirSync(vaultRoot, { recursive: true });

    const result = initGitRepo(vaultRoot);

    expect(result.initialized).toBe(true);
    expect(result.committed).toBe(true);
    expect(result.commitSha).toMatch(/^[0-9a-f]{7,40}$/);
    expect(fs.existsSync(path.join(vaultRoot, ".git"))).toBe(true);
    expect(git(["config", "--local", "commit.gpgsign"])).toBe("false");
    expect(git(["ls-files"])).toBe(".gitignore");
    expect(git(["status", "--porcelain"])).toBe("");
  });
});
