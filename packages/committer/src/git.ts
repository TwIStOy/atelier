import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

interface GitOptions {
  maxBuffer?: number;
  signal?: AbortSignal;
}

async function git(cwd: string, args: string[], opts?: GitOptions): Promise<string> {
  const { stdout } = await exec("git", args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: opts?.maxBuffer ?? 1_000_000,
    signal: opts?.signal,
  });
  return stdout;
}

export interface GitStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface DiffResult {
  stat: string;
  diff: string;
  files: string[];
}

export async function isGitRepo(cwd: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"], { signal });
    return true;
  } catch {
    return false;
  }
}

export async function getGitStatus(cwd: string, signal?: AbortSignal): Promise<GitStatus> {
  const output = await git(cwd, ["status", "--porcelain"], { signal });

  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const x = line[0];
    const y = line[1];
    const file = line.slice(3);

    if (x === "?" && y === "?") {
      untracked.push(file);
    } else if (x !== " " && x !== "?") {
      staged.push(file);
    } else if (y !== " ") {
      unstaged.push(file);
    }
  }

  return { staged, unstaged, untracked };
}

export async function hasStagedChanges(cwd: string, signal?: AbortSignal): Promise<boolean> {
  const status = await getGitStatus(cwd, signal);
  return status.staged.length > 0;
}

export async function stageAll(cwd: string, signal?: AbortSignal): Promise<void> {
  await git(cwd, ["add", "-A"], { signal });
}

export async function unstageAll(cwd: string, signal?: AbortSignal): Promise<void> {
  await git(cwd, ["reset", "HEAD", "--", "."], { signal });
}

export async function stageFiles(cwd: string, files: string[], signal?: AbortSignal): Promise<void> {
  if (files.length === 0) return;
  await git(cwd, ["add", "--", ...files], { signal });
}

export async function getDiff(cwd: string, maxBytes = 1_000_000, signal?: AbortSignal): Promise<DiffResult> {
  const [stat, diff, names] = await Promise.all([
    git(cwd, ["diff", "--cached", "--stat"], { maxBuffer: maxBytes, signal }),
    git(cwd, ["diff", "--cached"], { maxBuffer: maxBytes, signal }),
    git(cwd, ["diff", "--cached", "--name-only"], { signal }),
  ]);

  return { stat, diff, files: names.split("\n").filter(Boolean) };
}

export async function commit(cwd: string, message: string, signal?: AbortSignal): Promise<string> {
  await git(cwd, ["commit", "-m", message], { signal });
  const hash = await git(cwd, ["rev-parse", "--short", "HEAD"], { signal });
  return hash.trim();
}

export async function getBranchName(cwd: string, signal?: AbortSignal): Promise<string> {
  try {
    const name = await git(cwd, ["branch", "--show-current"], { signal });
    return name.trim();
  } catch {
    return "";
  }
}

export async function getLastCommitLog(cwd: string, count = 5, signal?: AbortSignal): Promise<string> {
  const log = await git(cwd, ["log", "--oneline", `-n${count}`], { signal });
  return log.trim();
}

export async function countChanges(cwd: string, signal?: AbortSignal): Promise<number> {
  const status = await getGitStatus(cwd, signal);
  return status.staged.length + status.unstaged.length + status.untracked.length;
}
