import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface InitGitRepoOptions {
  defaultBranch?: string;
  committerName?: string;
  committerEmail?: string;
  initialCommitMessage?: string;
}

export interface InitGitRepoResult {
  root: string;
  initialized: boolean;
  committed: boolean;
  commitSha?: string;
}

const DEFAULT_BRANCH = "main";
const DEFAULT_COMMITTER_NAME = "LLM Wiki";
const DEFAULT_COMMITTER_EMAIL = "llm-wiki@local";
const DEFAULT_COMMIT_MESSAGE = "Initial wiki vault";
const GITIGNORE_CONTENT = [".DS_Store", "*.tmp", ""].join("\n");
const SSH_COMMAND_STRIP_AGENT = "env -u SSH_AUTH_SOCK ssh";

function runGit(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

function hasHead(root: string): boolean {
  try {
    runGit(root, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

export function initGitRepo(root: string, opts: InitGitRepoOptions = {}): InitGitRepoResult {
  const branch = opts.defaultBranch ?? DEFAULT_BRANCH;
  const name = opts.committerName ?? DEFAULT_COMMITTER_NAME;
  const email = opts.committerEmail ?? DEFAULT_COMMITTER_EMAIL;
  const message = opts.initialCommitMessage ?? DEFAULT_COMMIT_MESSAGE;

  const alreadyRepo = fs.existsSync(path.join(root, ".git"));
  let initialized = false;
  if (!alreadyRepo) {
    runGit(root, ["init", "-b", branch]);
    initialized = true;
  }

  runGit(root, ["config", "--local", "commit.gpgsign", "false"]);
  runGit(root, ["config", "--local", "tag.gpgsign", "false"]);
  runGit(root, ["config", "--local", "core.sshCommand", SSH_COMMAND_STRIP_AGENT]);
  runGit(root, ["config", "--local", "user.name", name]);
  runGit(root, ["config", "--local", "user.email", email]);

  const gitignorePath = path.join(root, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, GITIGNORE_CONTENT, "utf8");
  }

  let committed = false;
  let commitSha: string | undefined;
  if (!hasHead(root)) {
    runGit(root, ["add", "-A"]);
    const dirty = runGit(root, ["status", "--porcelain"]);
    if (dirty.length > 0) {
      runGit(root, ["commit", "--no-verify", "-m", message]);
      commitSha = runGit(root, ["rev-parse", "HEAD"]);
      committed = true;
    }
  }

  return { root, initialized, committed, ...(commitSha ? { commitSha } : {}) };
}
