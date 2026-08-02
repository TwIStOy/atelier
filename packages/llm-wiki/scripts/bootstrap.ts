#!/usr/bin/env node
import * as path from "node:path";
import { bootstrapVault } from "../src/core/bootstrap.ts";
import { initGitRepo } from "../src/core/git.ts";
import { VAULT_DIR_NAME } from "../src/core/paths.ts";

interface ParsedArgs {
  parent: string;
  topic?: string;
}

function printUsage(): void {
  console.log(
    [
      "Usage: bootstrap.ts [parent-dir] [--topic \"<text>\"]",
      "",
      "Initializes an LLM Wiki vault at <parent-dir>/.llm-wiki and inits it as a git",
      "repo (gpgsign off, ssh-agent stripped) so it is manageable in a remote env.",
      "Idempotent — safe to re-run.",
      "parent-dir defaults to the current directory.",
      "",
      "Examples:",
      "  bootstrap.ts                                  # bootstrap <cwd>/.llm-wiki (project vault)",
      '  bootstrap.ts ~ --topic "Karpathy-style wiki"  # bootstrap ~/.llm-wiki (personal vault) with a topic',
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  let parent: string | undefined;
  let topic: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--topic") {
      topic = argv[++i];
      if (topic === undefined) throw new Error("--topic requires a value");
    } else if (arg.startsWith("--topic=")) {
      topic = arg.slice("--topic=".length);
    } else if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    } else {
      parent = arg;
    }
  }
  return { parent: parent ?? process.cwd(), topic };
}

const { parent, topic } = parseArgs(process.argv.slice(2));
const vaultRoot = path.join(parent, VAULT_DIR_NAME);
const result = bootstrapVault(vaultRoot, topic ? { topic } : {});
const gitResult = initGitRepo(vaultRoot);
const head = result.created
  ? `Initialized wiki at ${result.root} (${result.createdFiles.length} files created)`
  : `Wiki already initialized at ${result.root} (no changes)`;
const shortSha = gitResult.commitSha ? ` ${gitResult.commitSha.slice(0, 7)}` : "";
const gitLine = gitResult.initialized
  ? gitResult.committed
    ? `Initialized git repo at${shortSha} — commit.gpgsign off, ssh-agent disabled`
    : "Initialized git repo — commit.gpgsign off, ssh-agent disabled"
  : "Git repo already initialized (gpgsign off, ssh-agent disabled)";
console.log(`${head}${result.topic ? `\ntopic: ${result.topic}` : ""}\n${gitLine}`);
