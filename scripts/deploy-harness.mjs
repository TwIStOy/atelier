#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readdir, realpath, rm, symlink } from "node:fs/promises";import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.HOME;
if (!home) throw new Error("HOME is not set");
const configHome = process.env.XDG_CONFIG_HOME || join(home, ".config");

const actions = [];
let failed = false;

async function ensureLink(target, linkPath) {
  await mkdir(dirname(linkPath), { recursive: true });
  const stat = await lstat(linkPath).catch(() => null);
  if (stat?.isSymbolicLink()) {
    const current = await realpath(linkPath).catch(() => null);
    if (current === target) {
      return;
    }
    await rm(linkPath);
    await symlink(target, linkPath);
    actions.push(`updated link ${linkPath} -> ${target}`);
    return;
  }
  if (stat) {
    actions.push(`SKIPPED ${linkPath}: exists and is not a symlink`);
    return;
  }
  await symlink(target, linkPath);
  actions.push(`linked ${linkPath} -> ${target}`);
}

async function linkDir(source, destRoot, keep) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!keep(entry)) continue;
    await ensureLink(join(source, entry.name), join(destRoot, entry.name));
  }
}

async function deploySkills() {
  await linkDir(join(repoRoot, "skills"), join(home, ".agents", "skills"), (entry) => entry.isDirectory());
  await ensureLink(join(repoRoot, "prompts-resource"), join(home, ".agents", "prompts-resource"));
}

async function deployOpenCode() {
  const commandsDir = join(repoRoot, "harness", "opencode", "commands");
  await linkDir(commandsDir, join(configHome, "opencode", "commands"), (entry) => entry.name.endsWith(".md"));

  const pluginsDir = join(configHome, "opencode", "plugins");
  const distFile = join(repoRoot, "harness", "opencode", "plugins", "dist", "magpie.js");
  try {
    execFileSync(
      "bun",
      [
        "build",
        join(repoRoot, "harness", "opencode", "plugins", "magpie.ts"),
        "--target=bun",
        "--outfile",
        distFile,
      ],
      { stdio: "pipe" },
    );
    actions.push(`built opencode plugin ${distFile}`);
    await ensureLink(distFile, join(pluginsDir, "magpie.js"));
  } catch (error) {
    failed = true;
    actions.push(`FAILED: bun build of the magpie plugin: ${error.message}`);
  }
}

async function pruneHarnessLinks(destRoot) {
  for (const entry of await readdir(destRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isSymbolicLink()) continue;
    const linkPath = join(destRoot, entry.name);
    const target = await realpath(linkPath).catch(() => null);
    if (!target?.startsWith(`${join(repoRoot, "harness")}${sep}`)) continue;
    await rm(linkPath);
    actions.push(`pruned stale harness link ${linkPath} -> ${target}`);
  }
}

async function deployCursor() {
  const dest = join(home, ".cursor", "skills");
  await pruneHarnessLinks(dest);
  await linkDir(join(repoRoot, "skills"), dest, (entry) => entry.isDirectory());
}

await deploySkills();
await deployOpenCode();
await deployCursor();

for (const action of actions) {
  console.log(action);
}
console.log(`deploy-harness: ${actions.length} actions from ${repoRoot}`);
if (failed) {
  process.exitCode = 1;
}
