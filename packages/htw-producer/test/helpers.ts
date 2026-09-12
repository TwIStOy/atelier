import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GitRunner } from "../src/git-context.ts";

export const GIT_TABLE: Record<string, string> = {
  "git rev-parse --git-common-dir": "/srv/repo/.git",
  "git rev-parse --is-inside-work-tree": "true",
  "git rev-parse --show-toplevel": "/srv/repo",
  "git branch --show-current": "main",
  "git worktree list --porcelain": "worktree /srv/repo\nHEAD x\nbranch refs/heads/main\n",
};

export const NO_GIT_RUNNER: GitRunner = () => {
  throw new Error("no git");
};

export function gitRunner(): GitRunner {
  return (command) => {
    const out = GIT_TABLE[command];
    if (!out) throw new Error(`boom: ${command}`);
    return out;
  };
}

export interface CtxOpts {
  cwd?: string;
  tokens?: number | null;
  window?: number;
  percent?: number | null;
  model?: unknown;
  branch?: unknown[];
  sessionName?: string;
}

export function mockCtx(opts: CtxOpts = {}): ExtensionContext {
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
