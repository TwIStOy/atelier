import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function git(cwd: string, args: string[], opts?: { maxBuffer?: number }): Promise<string> {
  const { stdout } = await exec("git", args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: opts?.maxBuffer ?? 1_000_000,
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

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

export async function getGitStatus(cwd: string): Promise<GitStatus> {
  const output = await git(cwd, ["status", "--porcelain"]);

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

export async function hasStagedChanges(cwd: string): Promise<boolean> {
  const status = await getGitStatus(cwd);
  return status.staged.length > 0;
}

export async function stageAll(cwd: string): Promise<void> {
  await git(cwd, ["add", "-A"]);
}

export async function unstageAll(cwd: string): Promise<void> {
  await git(cwd, ["reset", "HEAD", "--", "."]);
}

export async function stageFiles(cwd: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  await git(cwd, ["add", "--", ...files]);
}

export async function getDiff(cwd: string, maxBytes = 1_000_000): Promise<DiffResult> {
  const [stat, diff, names] = await Promise.all([
    git(cwd, ["diff", "--cached", "--stat"], { maxBuffer: maxBytes }),
    git(cwd, ["diff", "--cached"], { maxBuffer: maxBytes }),
    git(cwd, ["diff", "--cached", "--name-only"]),
  ]);

  return { stat, diff, files: names.split("\n").filter(Boolean) };
}

export async function commit(cwd: string, message: string): Promise<string> {
  await git(cwd, ["commit", "-m", message]);
  const hash = await git(cwd, ["rev-parse", "--short", "HEAD"]);
  return hash.trim();
}

export async function getBranchName(cwd: string): Promise<string> {
  try {
    const name = await git(cwd, ["branch", "--show-current"]);
    return name.trim();
  } catch {
    return "";
  }
}

export async function getLastCommitLog(cwd: string, count = 5): Promise<string> {
  const log = await git(cwd, ["log", "--oneline", `-n${count}`]);
  return log.trim();
}

export async function countChanges(cwd: string): Promise<number> {
  const status = await getGitStatus(cwd);
  return status.staged.length + status.unstaged.length + status.untracked.length;
}
