import { describe, expect, test } from "vitest";
import { DiffTracker } from "../src/diff-tracker.ts";
import { createGitContextCache } from "../src/git-context.ts";
import { buildReport, computeSessionCost, summarizeToolArgs } from "../src/report.ts";
import { type CtxOpts, gitRunner, mockCtx, NO_GIT_RUNNER } from "./helpers.ts";

const diff = new DiffTracker();

interface ReportOpts extends CtxOpts {
  id?: string;
  status?: "working" | "idle" | "waiting" | "error" | "ended";
  tool?: { name: string; args: unknown };
  thinking?: boolean;
  lastUserInput?: string;
  env?: NodeJS.ProcessEnv;
  pid?: number;
  hostname?: string;
  git?: boolean;
}

function report(opts: ReportOpts = {}) {
  return buildReport({
    ctx: mockCtx(opts),
    id: opts.id ?? "abc123",
    startedAt: 1700_000_000,
    status: opts.status ?? "working",
    tool: opts.tool,
    thinking: opts.thinking,
    lastUserInput: opts.lastUserInput,
    diff: diff.snapshot(),
    gitCache: createGitContextCache(opts.git === false ? NO_GIT_RUNNER : gitRunner()),
    env: opts.env ?? {},
    pid: opts.pid,
    hostname: opts.hostname ?? "",
  });
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
    expect(computeSessionCost(mockCtx({ branch }))).toBeCloseTo(0.35);
  });

  test("zero when no assistant messages", () => {
    expect(computeSessionCost(mockCtx())).toBe(0);
  });
});

describe("buildReport", () => {
  test("required fields are always present and shaped per schema", () => {
    const out = report();
    expect(out.id).toBe("abc123");
    expect(out.cwd).toBe("/srv/repo");
    expect(out.status).toBe("working");
    expect(out.started_at).toBe(1700_000_000);
    expect(out.context).toEqual({ percent: 25, used: 50000, window: 200000 });
    expect(out.diff).toEqual({ add: 0, delete: 0 });
    expect(out.project).toBe("/srv/repo/.git");
    expect(out.worktree).toEqual({ root: "/srv/repo", main: "/srv/repo", branch: "main" });
  });

  test("falls back to basename project outside a repo", () => {
    const out = report({ git: false, cwd: "/home/me/myproj" });
    expect(out.project).toBe("myproj");
    expect(out.worktree).toBeUndefined();
  });

  test("tool field mirrors current tool with sanitized args", () => {
    const out = report({
      status: "working",
      tool: { name: "edit", args: { file: "a.ts", edits: [{ oldText: "x", newText: "y" }] } },
    });
    expect(out.tool).toEqual({ name: "edit", args: { file: "a.ts" } });
  });

  test("thinking and last_user_input carried when known", () => {
    const out = report({ thinking: true, lastUserInput: "fix the failing test" });
    expect(out.thinking).toBe(true);
    expect(out.last_user_input).toBe("fix the failing test");
  });

  test("last_user_input omitted when empty", () => {
    const out = report({ lastUserInput: "" });
    expect(out.last_user_input).toBeUndefined();
  });

  test("host reported when known, omitted when empty", () => {
    expect(report({ hostname: "asuka" }).host).toBe("asuka");
    expect(report({ hostname: "" }).host).toBeUndefined();
  });

  test("omits optional fields when absent (agent is always sent)", () => {
    const out = report({ status: "idle", git: false });
    expect(out.agent).toBe("pi");
    expect(out.title).toBeUndefined();
    expect(out.tool).toBeUndefined();
    expect(out.worktree).toBeUndefined();
    expect(out.cost).toBeUndefined();
    expect(out.tmux_pane).toBeUndefined();
    expect(out.pid).toBeUndefined();
    expect(out.thinking).toBeUndefined();
  });

  test("title comes from the session name when set", () => {
    expect(report({ sessionName: "Refactor auth" }).title).toBe("Refactor auth");
  });

  test("title falls back to the first user prompt when no session name", () => {
    const branch = [{ type: "message", message: { role: "user", content: "fix the login bug\non line 42" } }];
    expect(report({ branch }).title).toBe("fix the login bug on line 42");
  });

  test("title truncates long prompts to a single line", () => {
    const long = `Implement ${"a".repeat(200)}`;
    const out = report({ branch: [{ type: "message", message: { role: "user", content: long } }] });
    const title = out.title ?? "";
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("…")).toBe(true);
  });

  test("includes tmux_pane and pid when available", () => {
    const out = report({ env: { TMUX_PANE: "%12" }, pid: 4242 });
    expect(out.tmux_pane).toBe("%12");
    expect(out.pid).toBe(4242);
  });

  test("clamps and rounds percent into 0..=100", () => {
    expect(report({ percent: 133.333, tokens: 999 }).context.percent).toBe(100);
  });

  test("derives percent from tokens/window when percent missing", () => {
    const out = report({ percent: null, tokens: 50000, window: 200000 }).context;
    expect(out.percent).toBe(25);
    expect(out.used).toBe(50000);
  });

  test("zero percent when context usage unknown", () => {
    expect(report({ percent: null, tokens: null }).context).toEqual({ percent: 0 });
  });
});
