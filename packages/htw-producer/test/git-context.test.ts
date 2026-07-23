import { describe, expect, test } from "vitest";
import { createGitContextCache, type GitRunner, resolveGitContext } from "../src/git-context.ts";

const NOT_IN_REPO: Record<string, string> = {
  "git rev-parse --git-common-dir": "__FAIL__",
  "git rev-parse --is-inside-work-tree": "false",
};

const MAIN_WORKTREE: Record<string, string> = {
  "git rev-parse --git-common-dir": "/srv/repo/.git",
  "git rev-parse --is-inside-work-tree": "true",
  "git rev-parse --show-toplevel": "/srv/repo",
  "git branch --show-current": "main",
  "git worktree list --porcelain": "worktree /srv/repo\nHEAD abc\nbranch refs/heads/main\n",
};

const LINKED_WORKTREE: Record<string, string> = {
  "git rev-parse --git-common-dir": "/srv/repo/.git",
  "git rev-parse --is-inside-work-tree": "true",
  "git rev-parse --show-toplevel": "/srv/wt/feat",
  "git branch --show-current": "feat",
  "git worktree list --porcelain":
    "worktree /srv/repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /srv/wt/feat\nHEAD def\nbranch refs/heads/feat\n",
};

const DETACHED: Record<string, string> = {
  "git rev-parse --git-common-dir": "/srv/repo/.git",
  "git rev-parse --is-inside-work-tree": "true",
  "git rev-parse --show-toplevel": "/srv/repo",
  "git branch --show-current": "",
  "git worktree list --porcelain": "worktree /srv/repo\nHEAD abc\ndetached\n",
};

function runner(table: Record<string, string>): GitRunner {
  return (command) => {
    const out = table[command];
    if (out === "__FAIL__" || out === undefined) throw new Error(`boom: ${command}`);
    return out;
  };
}

describe("resolveGitContext", () => {
  test("not in a repo falls back to directory basename and no worktree", () => {
    const ctx = resolveGitContext("/home/me/myproj", runner(NOT_IN_REPO));
    expect(ctx.project).toBe("myproj");
    expect(ctx.worktree).toBeUndefined();
  });

  test("ungrouped bucket for root path", () => {
    const ctx = resolveGitContext("/", runner(NOT_IN_REPO));
    expect(ctx.project).toBe("ungrouped");
  });

  test("main worktree: project is common dir, worktree present with branch", () => {
    const ctx = resolveGitContext("/srv/repo", runner(MAIN_WORKTREE));
    expect(ctx.project).toBe("/srv/repo/.git");
    expect(ctx.worktree).toEqual({ root: "/srv/repo", main: "/srv/repo", branch: "main" });
  });

  test("linked worktree: main is the first porcelain entry, root is this worktree", () => {
    const ctx = resolveGitContext("/srv/wt/feat", runner(LINKED_WORKTREE));
    expect(ctx.project).toBe("/srv/repo/.git");
    expect(ctx.worktree?.root).toBe("/srv/wt/feat");
    expect(ctx.worktree?.main).toBe("/srv/repo");
    expect(ctx.worktree?.branch).toBe("feat");
  });

  test("detached HEAD omits branch", () => {
    const ctx = resolveGitContext("/srv/repo", runner(DETACHED));
    expect(ctx.worktree?.branch).toBeUndefined();
  });

  test("relative common dir is resolved against cwd", () => {
    const table = { ...MAIN_WORKTREE, "git rev-parse --git-common-dir": ".git" };
    const ctx = resolveGitContext("/srv/repo", runner(table));
    expect(ctx.project).toBe("/srv/repo/.git");
  });
});

describe("createGitContextCache", () => {
  test("caches per cwd and only resolves once", () => {
    let calls = 0;
    const run: GitRunner = (command) => {
      calls++;
      const out = MAIN_WORKTREE[command];
      if (!out) throw new Error("boom");
      return out;
    };
    const cache = createGitContextCache(run);
    const a = cache.get("/srv/repo");
    const b = cache.get("/srv/repo");
    expect(a).toBe(b);
    expect(calls).toBe(MAIN_WORKTREE_SIZE);
    cache.get("/srv/repo");
    expect(calls).toBe(MAIN_WORKTREE_SIZE);
  });

  test("clear resets the cache", () => {
    let calls = 0;
    const run: GitRunner = (command) => {
      calls++;
      const out = MAIN_WORKTREE[command];
      if (!out) throw new Error("boom");
      return out;
    };
    const cache = createGitContextCache(run);
    cache.get("/srv/repo");
    cache.clear();
    cache.get("/srv/repo");
    expect(calls).toBe(MAIN_WORKTREE_SIZE * 2);
  });
});

const MAIN_WORKTREE_SIZE = Object.keys(MAIN_WORKTREE).length;
