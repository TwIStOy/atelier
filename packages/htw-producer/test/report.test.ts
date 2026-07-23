import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "vitest";
import { DiffTracker } from "../src/diff-tracker.ts";
import { createGitContextCache, type GitRunner } from "../src/git-context.ts";
import { buildReport, computeSessionCost, summarizeToolArgs } from "../src/report.ts";

const GIT_TABLE: Record<string, string> = {
  "git rev-parse --git-common-dir": "/srv/repo/.git",
  "git rev-parse --is-inside-work-tree": "true",
  "git rev-parse --show-toplevel": "/srv/repo",
  "git branch --show-current": "main",
  "git worktree list --porcelain": "worktree /srv/repo\nHEAD x\nbranch refs/heads/main\n",
};

const NO_GIT_RUNNER: GitRunner = () => {
  throw new Error("no git");
};

function gitRunner(): GitRunner {
  return (command) => {
    const out = GIT_TABLE[command];
    if (!out) throw new Error(`boom: ${command}`);
    return out;
  };
}

interface CtxOpts {
  cwd?: string;
  tokens?: number | null;
  window?: number;
  percent?: number | null;
  model?: unknown;
  branch?: unknown[];
  sessionName?: string;
}

function mockCtx(opts: CtxOpts = {}): ExtensionContext {
  return {
    cwd: opts.cwd ?? "/srv/repo",
    model: opts.model ?? { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "anthropic" },
    getContextUsage: () => {
      if (opts.tokens === null && opts.percent === null) return undefined;
      return {
        tokens: opts.tokens ?? 50000,
        contextWindow: opts.window ?? 200000,
        percent: opts.percent ?? 25,
      };
    },
    sessionManager: {
      getSessionId: () => "abc123",
      getSessionName: () => opts.sessionName,
      getBranch: () => opts.branch ?? [],
    },
  } as unknown as ExtensionContext;
}

describe("summarizeToolArgs", () => {
  test("keeps small identifying fields", () => {
    expect(summarizeToolArgs("edit", { file: "a.ts", edits: [] })).toEqual({ file: "a.ts" });
  });

  test("bash prefers command", () => {
    expect(summarizeToolArgs("bash", { command: "ls -la" })).toEqual({ command: "ls -la" });
  });

  test("truncates long values", () => {
    const long = "x".repeat(500);
    const out = summarizeToolArgs("bash", { command: long });
    expect((out.command as string).length).toBeLessThan(500);
    expect((out.command as string).endsWith("…")).toBe(true);
  });

  test("returns empty object for no recognizable fields", () => {
    expect(summarizeToolArgs("grep", { foo: 1 })).toEqual({});
  });
});

describe("computeSessionCost", () => {
  test("sums assistant message costs", () => {
    const branch = [
      { type: "message", message: { role: "assistant", usage: { cost: { total: 0.1 } } } },
      { type: "message", message: { role: "assistant", usage: { cost: { total: 0.25 } } } },
      { type: "message", message: { role: "user", content: "hi" } },
    ];
    expect(computeSessionCost(mockCtx({ branch }) as ExtensionContext)).toBeCloseTo(0.35);
  });

  test("zero when no assistant messages", () => {
    expect(computeSessionCost(mockCtx() as ExtensionContext)).toBe(0);
  });
});

describe("buildReport", () => {
  const diff = new DiffTracker();

  test("required fields are always present and shaped per schema", () => {
    const report = buildReport({
      ctx: mockCtx(),
      sessionId: "abc123",
      startedAt: 1700_000_000,
      status: "working",
      diff: diff.snapshot(),
      gitCache: createGitContextCache(NO_GIT_RUNNER),
      env: {},
    });
    expect(report.id).toBe("abc123");
    expect(report.cwd).toBe("/srv/repo");
    expect(report.status).toBe("working");
    expect(report.started_at).toBe(1700_000_000);
    expect(report.context).toEqual({ percent: 25, used: 50000, window: 200000 });
    expect(report.diff).toEqual({ add: 0, delete: 0 });
  });

  test("falls back to basename project outside a repo", () => {
    const report = buildReport({
      ctx: mockCtx({ cwd: "/home/me/myproj" }),
      sessionId: "x",
      startedAt: 1,
      status: "idle",
      diff: diff.snapshot(),
      gitCache: createGitContextCache(NO_GIT_RUNNER),
      env: {},
    });
    expect(report.project).toBe("myproj");
    expect(report.worktree).toBeUndefined();
  });

  test("includes worktree when inside a repo", () => {
    const report = buildReport({
      ctx: mockCtx(),
      sessionId: "x",
      startedAt: 1,
      status: "idle",
      diff: diff.snapshot(),
      gitCache: createGitContextCache(gitRunner()),
      env: {},
    });
    expect(report.project).toBe("/srv/repo/.git");
    expect(report.worktree).toEqual({ root: "/srv/repo", main: "/srv/repo", branch: "main" });
  });

  test("tool field mirrors current tool with sanitized args", () => {
    const report = buildReport({
      ctx: mockCtx(),
      sessionId: "x",
      startedAt: 1,
      status: "working",
      tool: { name: "edit", args: { file: "a.ts", edits: [{ oldText: "x", newText: "y" }] } },
      diff: diff.snapshot(),
      gitCache: createGitContextCache(NO_GIT_RUNNER),
      env: {},
    });
    expect(report.tool).toEqual({ name: "edit", args: { file: "a.ts" } });
  });

  test("omits optional fields when absent (agent is always sent)", () => {
    const report = buildReport({
      ctx: mockCtx(),
      sessionId: "x",
      startedAt: 1,
      status: "idle",
      diff: diff.snapshot(),
      gitCache: createGitContextCache(NO_GIT_RUNNER),
      env: {},
    });
    expect(report.agent).toBe("pi");
    expect(report.title).toBeUndefined();
    expect(report.tool).toBeUndefined();
    expect(report.worktree).toBeUndefined();
    expect(report.cost).toBeUndefined();
    expect(report.tmux_pane).toBeUndefined();
    expect(report.pid).toBeUndefined();
  });

  test("title comes from the session name when set", () => {
    const report = buildReport({
      ctx: mockCtx({ sessionName: "Refactor auth" }),
      sessionId: "x",
      startedAt: 1,
      status: "idle",
      diff: diff.snapshot(),
      gitCache: createGitContextCache(NO_GIT_RUNNER),
      env: {},
    });
    expect(report.title).toBe("Refactor auth");
  });

  test("title falls back to the first user prompt when no session name", () => {
    const branch = [{ type: "message", message: { role: "user", content: "fix the login bug\non line 42" } }];
    const report = buildReport({
      ctx: mockCtx({ branch }),
      sessionId: "x",
      startedAt: 1,
      status: "working",
      diff: diff.snapshot(),
      gitCache: createGitContextCache(NO_GIT_RUNNER),
      env: {},
    });
    expect(report.title).toBe("fix the login bug on line 42");
  });

  test("title truncates long prompts to a single line", () => {
    const long = `Implement ${"a".repeat(200)}`;
    const report = buildReport({
      ctx: mockCtx({ branch: [{ type: "message", message: { role: "user", content: long } }] }),
      sessionId: "x",
      startedAt: 1,
      status: "idle",
      diff: diff.snapshot(),
      gitCache: createGitContextCache(NO_GIT_RUNNER),
      env: {},
    });
    const title = report.title ?? "";
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("…")).toBe(true);
  });

  test("session name takes priority over the first user prompt", () => {
    const branch = [{ type: "message", message: { role: "user", content: "hello" } }];
    const report = buildReport({
      ctx: mockCtx({ sessionName: "Named", branch }),
      sessionId: "x",
      startedAt: 1,
      status: "idle",
      diff: diff.snapshot(),
      gitCache: createGitContextCache(NO_GIT_RUNNER),
      env: {},
    });
    expect(report.title).toBe("Named");
  });

  test("includes tmux_pane and pid when available", () => {
    const report = buildReport({
      ctx: mockCtx(),
      sessionId: "x",
      startedAt: 1,
      status: "idle",
      diff: diff.snapshot(),
      gitCache: createGitContextCache(NO_GIT_RUNNER),
      env: { TMUX_PANE: "%12" },
      pid: 4242,
    });
    expect(report.tmux_pane).toBe("%12");
    expect(report.pid).toBe(4242);
  });

  test("clamps and rounds percent into 0..=100", () => {
    const report = buildReport({
      ctx: mockCtx({ percent: 133.333, tokens: 999 }),
      sessionId: "x",
      startedAt: 1,
      status: "idle",
      diff: diff.snapshot(),
      gitCache: createGitContextCache(NO_GIT_RUNNER),
      env: {},
    });
    expect(report.context.percent).toBe(100);
  });

  test("derives percent from tokens/window when percent missing", () => {
    const report = buildReport({
      ctx: mockCtx({ percent: null, tokens: 50000, window: 200000 }),
      sessionId: "x",
      startedAt: 1,
      status: "idle",
      diff: diff.snapshot(),
      gitCache: createGitContextCache(NO_GIT_RUNNER),
      env: {},
    });
    expect(report.context.percent).toBe(25);
    expect(report.context.used).toBe(50000);
  });

  test("zero percent when context usage unknown", () => {
    const report = buildReport({
      ctx: mockCtx({ percent: null, tokens: null, window: 200000 }),
      sessionId: "x",
      startedAt: 1,
      status: "idle",
      diff: diff.snapshot(),
      gitCache: createGitContextCache(NO_GIT_RUNNER),
      env: {},
    });
    expect(report.context).toEqual({ percent: 0 });
  });
});
