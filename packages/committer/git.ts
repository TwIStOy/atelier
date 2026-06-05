import { execSync } from "node:child_process";

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

export function isGitRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

export function getGitStatus(cwd: string): GitStatus {
  const output = execSync("git status --porcelain", {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

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

export function hasStagedChanges(cwd: string): boolean {
  const status = getGitStatus(cwd);
  return status.staged.length > 0;
}

export function stageAll(cwd: string): void {
  execSync("git add -A", { cwd, encoding: "utf-8", stdio: "pipe" });
}

export function unstageAll(cwd: string): void {
  execSync("git reset HEAD -- .", { cwd, encoding: "utf-8", stdio: "pipe" });
}

export function stageFiles(cwd: string, files: string[]): void {
  if (files.length === 0) return;
  const args = files.map((f) => (f.includes(" ") ? `"${f}"` : f));
  execSync(`git add -- ${args.join(" ")}`, {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
  });
}

export function getDiff(cwd: string, maxBytes = 1_000_000): DiffResult {
  const stat = execSync("git diff --cached --stat", {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
    maxBuffer: maxBytes,
  });

  const diff = execSync("git diff --cached", {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
    maxBuffer: maxBytes,
  });

  const files = execSync("git diff --cached --name-only", {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
  })
    .split("\n")
    .filter(Boolean);

  return { stat, diff, files };
}

export function commit(cwd: string, message: string): string {
  const fsMsg = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  execSync(`git commit -m "${fsMsg}"`, {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
  });

  const commitHash = execSync("git rev-parse --short HEAD", {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();

  return commitHash;
}

export function getBranchName(cwd: string): string {
  try {
    return execSync("git branch --show-current", {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    return "";
  }
}

export function getLastCommitLog(cwd: string, count = 5): string {
  return execSync(`git log --oneline -n ${count}`, {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
}

export function countChanges(cwd: string): number {
  const status = getGitStatus(cwd);
  return (
    status.staged.length + status.unstaged.length + status.untracked.length
  );
}
