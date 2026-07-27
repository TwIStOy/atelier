import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";
import { GitComponent, parseGitPorcelain } from "../src/components/git.ts";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function fakeTheme(): {
  fg: (_color: string, text: string) => string;
} {
  return {
    fg: (_color: string, text: string) => text,
  };
}

describe("GitComponent.render width contract", () => {
  test("renders nothing when branch is unknown", () => {
    const git = new GitComponent("/nonexistent");
    expect(git.render(42, fakeTheme() as never)).toEqual([]);
  });

  test("never exceeds the given width for a long branch", async () => {
    const git = new GitComponent(process.cwd());
    await new Promise<void>((resolve) => {
      git.bindRender(resolve);
    });
    for (const width of [80, 42, 30, 20, 12, 8, 5, 1]) {
      const lines = git.render(width, fakeTheme() as never);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  test("uses ellipsis when truncating, keeps the marker", async () => {
    const git = new GitComponent(process.cwd());
    await new Promise<void>((resolve) => {
      git.bindRender(resolve);
    });
    const lines = git.render(10, fakeTheme() as never);
    const plain = stripAnsi(lines.join(""));
    expect(plain).toMatch(/[✓✗]/);
  });
});

describe("parseGitPorcelain", () => {
  test("parses clean branch with upstream", () => {
    const s = parseGitPorcelain("## main...origin/main\n");
    expect(s.branch).toBe("main");
    expect(s.ahead).toBe(0);
    expect(s.behind).toBe(0);
    expect(s.staged + s.modified + s.untracked + s.conflicted).toBe(0);
  });

  test("parses ahead and behind", () => {
    const s = parseGitPorcelain("## main...origin/main [ahead 2, behind 1]\n");
    expect(s.ahead).toBe(2);
    expect(s.behind).toBe(1);
  });

  test("detects detached HEAD", () => {
    const s = parseGitPorcelain("## HEAD (no branch)\n");
    expect(s.detached).toBe(true);
    expect(s.branch).toBeNull();
  });

  test("counts staged, modified, untracked, conflicted", () => {
    const s = parseGitPorcelain(
      [
        "## main",
        "# stash 2",
        "M  staged-only.js",
        "MM staged-and-modified.js",
        " M worktree-modified.js",
        "?? untracked.txt",
        "UU conflict.txt",
      ].join("\n"),
    );
    expect(s.staged).toBe(2);
    expect(s.modified).toBe(2);
    expect(s.untracked).toBe(1);
    expect(s.conflicted).toBe(1);
    expect(s.stashed).toBe(2);
  });
});
