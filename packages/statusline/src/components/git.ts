import { execFile } from "node:child_process";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { StatusLineComponent } from "./base.ts";

export interface GitStatus {
  branch: string | null;
  detached: boolean;
  shortHash: string | null;
  ahead: number;
  behind: number;
  stashed: number;
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
}

function emptyStatus(): GitStatus {
  return {
    branch: null,
    detached: false,
    shortHash: null,
    ahead: 0,
    behind: 0,
    stashed: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicted: 0,
  };
}

function isDirty(s: GitStatus): boolean {
  return s.staged + s.modified + s.untracked + s.conflicted > 0;
}

function parseBranchHeader(header: string, status: GitStatus): void {
  if (header.startsWith("HEAD (no branch)")) {
    status.detached = true;
    return;
  }
  const branchMatch = header.match(/^(\S+?)(?:\.\.\.\S+)?(?:\s+\[([^\]]+)\])?$/);
  if (branchMatch) status.branch = branchMatch[1];
  if (branchMatch?.[2]) applyAheadBehind(branchMatch[2], status);
}

function applyAheadBehind(bracket: string, status: GitStatus): void {
  for (const part of bracket.split(", ")) {
    const ahead = part.match(/^ahead (\d+)$/);
    if (ahead) status.ahead = parseInt(ahead[1], 10);
    const behind = part.match(/^behind (\d+)$/);
    if (behind) status.behind = parseInt(behind[1], 10);
  }
}

function isConflicted(x: string, y: string): boolean {
  return x === "U" || y === "U" || (x === "C" && y === "C");
}

function countStagedAndModified(x: string, y: string, status: GitStatus): void {
  if (x !== " " && x !== "?") status.staged++;
  if (y === "M" || y === "D") status.modified++;
}

function countEntryFlags(x: string, y: string, status: GitStatus): void {
  if (isConflicted(x, y)) {
    status.conflicted++;
  } else if (x === "?" && y === "?") {
    status.untracked++;
  } else {
    countStagedAndModified(x, y, status);
  }
}

/**
 * Parse `git status --porcelain=v1 --branch --show-stash` output into a
 * structured status. Branch header forms handled:
 *   `## main` · `## main...origin/main` · `## main...origin/main [ahead 2]`
 *   `## main [ahead 2, behind 1]` · `## HEAD (no branch)` (detached)
 */
export function parseGitPorcelain(stdout: string): GitStatus {
  const status = emptyStatus();
  const lines = stdout.split("\n");

  for (const line of lines) {
    if (line === "") continue;

    if (line.startsWith("## ")) {
      parseBranchHeader(line.slice(3), status);
      continue;
    }

    if (line.startsWith("# stash ")) {
      status.stashed = parseInt(line.slice(8).trim(), 10) || 0;
      continue;
    }

    countEntryFlags(line[0], line[1], status);
  }

  return status;
}

export class GitComponent implements StatusLineComponent {
  private status: GitStatus | null = null;
  private refreshing = false;
  private requestRender: (() => void) | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private cwd: string) {}

  bindRender(fn: () => void) {
    this.requestRender = fn;
    this.scheduleRefresh(0);
  }

  dispose() {
    this.disposed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private scheduleRefresh(delayMs: number) {
    if (this.disposed) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refresh().catch(() => {});
    }, delayMs);
  }

  private async refresh() {
    if (this.disposed) return;
    if (this.refreshing) return;
    this.refreshing = true;

    try {
      const status = await this.readStatus(this.cwd);
      this.status = status;
    } catch {
      this.status = null;
    }

    this.refreshing = false;
    if (this.disposed) return;
    this.requestRender?.();
    this.scheduleRefresh(5000);
  }

  private async readStatus(cwd: string): Promise<GitStatus | null> {
    const stdout = await this.git(["status", "--porcelain=v1", "--branch", "--show-stash"], cwd);
    if (stdout === null) return null;
    const status = parseGitPorcelain(stdout);
    if (status.detached) {
      const hash = await this.git(["rev-parse", "--short", "HEAD"], cwd);
      status.shortHash = hash?.trim() || null;
    }
    return status;
  }

  private git(args: string[], cwd: string): Promise<string | null> {
    return new Promise((resolve) => {
      execFile("git", args, { cwd, encoding: "utf-8" }, (err, stdout) => {
        resolve(err ? null : stdout);
      });
    });
  }

  render(width: number, theme: Theme): string[] {
    const status = this.status;
    if (!status || (!status.branch && !status.detached)) return [];

    const label = status.detached ? (status.shortHash ?? "detached") : status.branch;

    const ahead = status.ahead > 0 ? ` ↑${status.ahead}` : "";
    const behind = status.behind > 0 ? ` ↓${status.behind}` : "";
    const dirty = isDirty(status);
    const marker = dirty ? theme.fg("error", "✗") : theme.fg("success", "✓");

    const budget = Math.max(0, width - visibleWidth(marker) - 1);
    const head = truncateToWidth(`${label}${ahead}${behind}`, budget, "…");
    return [truncateToWidth(`${theme.fg("muted", head)} ${marker}`, width, "")];
  }
}
