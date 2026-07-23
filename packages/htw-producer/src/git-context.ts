import { execSync } from "node:child_process";

export interface WorktreeInfo {
  root: string;
  main: string;
  branch?: string;
}

export interface GitContext {
  project: string;
  worktree?: WorktreeInfo;
}

export type GitRunner = (command: string, opts: { cwd: string }) => string;

const DEFAULT_RUNNER: GitRunner = (command, opts) =>
  execSync(command, { ...opts, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8", timeout: 2000 }).trim();

function runOptional(run: GitRunner, command: string, cwd: string): string | undefined {
  try {
    const out = run(command, { cwd });
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

function makeAbsolute(commonDir: string, cwd: string): string {
  if (commonDir.startsWith("/")) return commonDir;
  return `${cwd.replace(/\/$/, "")}/${commonDir}`;
}

export function resolveGitContext(cwd: string, run: GitRunner = DEFAULT_RUNNER): GitContext {
  const commonDir = runOptional(run, "git rev-parse --git-common-dir", cwd);
  const project = commonDir ? makeAbsolute(commonDir, cwd) : fallbackProject(cwd);

  const insideWorkTree = runOptional(run, "git rev-parse --is-inside-work-tree", cwd);
  if (insideWorkTree !== "true") {
    return { project };
  }

  const root = runOptional(run, "git rev-parse --show-toplevel", cwd);
  const branch = runOptional(run, "git branch --show-current", cwd);
  const main = firstWorktree(run, cwd) ?? root;

  if (!root || !main) {
    return { project };
  }

  const worktree: WorktreeInfo = { root, main };
  if (branch) worktree.branch = branch;
  return { project, worktree };
}

function firstWorktree(run: GitRunner, cwd: string): string | undefined {
  const out = runOptional(run, "git worktree list --porcelain", cwd);
  if (!out) return undefined;
  for (const line of out.split(/\r?\n/)) {
    const match = line.match(/^worktree\s+(.+)$/);
    if (match) return match[1].trim();
  }
  return undefined;
}

function fallbackProject(cwd: string): string {
  const base = cwd.replace(/\/+$/, "").split("/").pop();
  return base && base.length > 0 ? base : "ungrouped";
}

export interface GitContextCache {
  get(cwd: string): GitContext;
  clear(): void;
}

export function createGitContextCache(run: GitRunner = DEFAULT_RUNNER): GitContextCache {
  const cache = new Map<string, GitContext>();
  return {
    get(cwd: string): GitContext {
      const hit = cache.get(cwd);
      if (hit) return hit;
      const ctx = resolveGitContext(cwd, run);
      cache.set(cwd, ctx);
      return ctx;
    },
    clear(): void {
      cache.clear();
    },
  };
}
