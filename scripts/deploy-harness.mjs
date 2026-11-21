#!/usr/bin/env node
import { lstat, mkdir, readdir, readlink, realpath, rm, symlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.HOME;
if (!home) throw new Error("HOME is not set");
const configHome = process.env.XDG_CONFIG_HOME || join(home, ".config");

const actions = [];

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

async function pruneRepoLinks(destPath, ...repoPrefixes) {
  const stat = await lstat(destPath).catch(() => null);
  if (!stat) return;
  const matchesRepo = async (linkPath) => {
    const target = await readlink(linkPath).catch(() => null);
    return target !== null && repoPrefixes.some((prefix) => target.startsWith(prefix));
  };
  if (stat.isSymbolicLink()) {
    if (await matchesRepo(destPath)) {
      await rm(destPath);
      actions.push(`pruned stale link ${destPath}`);
    }
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of await readdir(destPath, { withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue;
    const linkPath = join(destPath, entry.name);
    if (!(await matchesRepo(linkPath))) continue;
    await rm(linkPath);
    actions.push(`pruned stale link ${linkPath}`);
  }
}

const harnessDir = `${join(repoRoot, "harness")}${sep}`;
const promptsResourceDir = join(repoRoot, "prompts-resource");

async function linkDir(source, destRoot, keep) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!keep(entry)) continue;
    await ensureLink(join(source, entry.name), join(destRoot, entry.name));
  }
}

async function deploySkills() {
  await linkDir(join(repoRoot, "skills"), join(home, ".agents", "skills"), (entry) => entry.isDirectory());
  await pruneRepoLinks(join(home, ".agents", "prompts-resource"), promptsResourceDir);
}

async function deployOpenCode() {
  await pruneRepoLinks(join(configHome, "opencode", "commands"), harnessDir);

  const pluginsDir = join(configHome, "opencode", "plugins");
  const retiredBundle = join(pluginsDir, "magpie.js");
  const bundleStat = await lstat(retiredBundle).catch(() => null);
  if (bundleStat?.isSymbolicLink()) {
    await rm(retiredBundle);
    actions.push(`pruned retired bundle link ${retiredBundle}`);
  }
  const pluginFile = join(repoRoot, "harness", "opencode", "plugins", "magpie.ts");
  await ensureLink(pluginFile, join(pluginsDir, "magpie.ts"));
}

async function deployCursor() {
  const dest = join(home, ".cursor", "skills");
  await pruneRepoLinks(dest, harnessDir);
  await linkDir(join(repoRoot, "skills"), dest, (entry) => entry.isDirectory());
}

await deploySkills();
await deployOpenCode();
await deployCursor();

for (const action of actions) {
  console.log(action);
}
console.log(`deploy-harness: ${actions.length} actions from ${repoRoot}`);
