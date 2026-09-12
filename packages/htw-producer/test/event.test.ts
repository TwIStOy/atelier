import { describe, expect, test } from "vitest";
import { DiffTracker } from "../src/diff-tracker.ts";
import { buildEnvelope, type EventPayload, sessionKey } from "../src/event.ts";
import { createGitContextCache } from "../src/git-context.ts";
import { type CtxOpts, gitRunner, mockCtx, NO_GIT_RUNNER } from "./helpers.ts";

const diff = new DiffTracker();

interface EnvelopeOpts extends CtxOpts {
  sessionId?: string;
  event?: EventPayload;
  env?: NodeJS.ProcessEnv;
  pid?: number;
  hostname?: string;
  git?: boolean;
}

function envelope(opts: EnvelopeOpts = {}) {
  return buildEnvelope({
    ctx: mockCtx(opts),
    sessionId: opts.sessionId ?? "abc123",
    startedAt: 1700_000_000,
    event: opts.event ?? { type: "turn_completed" },
    diff: diff.snapshot(),
    gitCache: createGitContextCache(opts.git === false ? NO_GIT_RUNNER : gitRunner()),
    env: opts.env ?? {},
    pid: opts.pid,
    hostname: opts.hostname ?? "",
  });
}

describe("sessionKey", () => {
  test("composes the daemon's composite session id", () => {
    expect(sessionKey("abc123")).toBe("pi/abc123");
  });
});

describe("buildEnvelope", () => {
  test("required identity fields are always present", () => {
    const out = envelope({ event: { type: "session_started" } });
    expect(out.harness).toBe("pi");
    expect(out.session_id).toBe("abc123");
    expect(out.cwd).toBe("/srv/repo");
    expect(out.event).toEqual({ type: "session_started" });
  });

  test("carries prompt text on user_prompt", () => {
    const out = envelope({ event: { type: "user_prompt", text: "fix the failing test" } });
    expect(out.event).toEqual({ type: "user_prompt", text: "fix the failing test" });
  });

  test("carries name and args on tool_started", () => {
    const out = envelope({
      event: { type: "tool_started", name: "bash", args: { command: "cargo test" } },
    });
    expect(out.event).toEqual({ type: "tool_started", name: "bash", args: { command: "cargo test" } });
  });

  test("remembered attributes: context, diff, started_at, project, model always present", () => {
    const out = envelope();
    expect(out.context).toEqual({ percent: 25, used: 50000, window: 200000 });
    expect(out.diff).toEqual({ add: 0, delete: 0 });
    expect(out.started_at).toBe(1700_000_000);
    expect(out.project).toBe("/srv/repo/.git");
    expect(out.model).toBe("Claude Sonnet 4.5");
  });

  test("project falls back to cwd basename outside a repo", () => {
    const out = envelope({ git: false, cwd: "/home/me/myproj" });
    expect(out.project).toBe("myproj");
    expect(out.worktree).toBeUndefined();
  });

  test("worktree carried when inside a repo", () => {
    const out = envelope();
    expect(out.worktree).toEqual({ root: "/srv/repo", main: "/srv/repo", branch: "main" });
  });

  test("cost carried only when the session accrued one", () => {
    expect(envelope().cost).toBeUndefined();
    const branch = [{ type: "message", message: { role: "assistant", usage: { cost: { total: 0.25 } } } }];
    expect(envelope({ branch }).cost).toBe(0.25);
  });

  test("tmux_pane, pid and host carried when known", () => {
    const out = envelope({ env: { TMUX_PANE: "%12" }, pid: 4242, hostname: "asuka" });
    expect(out.tmux_pane).toBe("%12");
    expect(out.pid).toBe(4242);
    expect(out.host).toBe("asuka");
  });

  test("host omitted when empty", () => {
    expect(envelope({ hostname: "" }).host).toBeUndefined();
  });

  test("title derived like the snapshot report", () => {
    expect(envelope({ sessionName: "Refactor auth" }).title).toBe("Refactor auth");
  });

  test("envelope is JSON-serializable without nulls", () => {
    const raw = JSON.stringify(envelope({ git: false }));
    expect(raw).not.toContain("null");
  });
});
