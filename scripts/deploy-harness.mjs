#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
  await linkDir(join(repoRoot, ".agents", "skills"), join(home, ".agents", "skills"), (entry) => entry.isDirectory());
  await ensureLink(join(repoRoot, "prompts-resource"), join(home, ".agents", "prompts-resource"));
}

async function deployOpenCode() {
  const commandsDir = join(repoRoot, "harness", "opencode", "commands");
  await linkDir(commandsDir, join(configHome, "opencode", "commands"), (entry) => entry.name.endsWith(".md"));

  const pluginsDir = join(configHome, "opencode", "plugins");
  await mkdir(pluginsDir, { recursive: true });
  try {
    execFileSync(
      "bun",
      [
        "build",
        join(repoRoot, "harness", "opencode", "plugins", "magpie.ts"),
        "--target=bun",
        "--outfile",
        join(pluginsDir, "magpie.js"),
      ],
      { stdio: "pipe" },
    );
    actions.push(`built opencode plugin ${join(pluginsDir, "magpie.js")}`);
  } catch (error) {
    failed = true;
    actions.push(`FAILED: bun build of the magpie plugin: ${error.message}`);
  }

  const configPath = join(configHome, "opencode", "opencode.json");
  let config;
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    config = {};
  }
  if (config.provider?.magpie) {
    actions.push(`kept existing provider.magpie in ${configPath}`);
    return;
  }
  const snippetText = await readFile(join(repoRoot, "harness", "opencode", "provider-magpie.json"), "utf8");
  config.provider = { ...config.provider, magpie: JSON.parse(snippetText) };
  try {
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    actions.push(`merged provider.magpie into ${configPath}`);
  } catch {
    const providerJson = JSON.stringify({ provider: { magpie: JSON.parse(snippetText) } }, null, 2);
    actions.push(
      `provider.magpie is missing from ${configPath} and the file is not writable (Nix-managed?). Merge this into your opencode config manually:\n${providerJson}`,
    );
  }
}

async function deployCursor() {
  await linkDir(
    join(repoRoot, "harness", "cursor", "skills"),
    join(home, ".cursor", "skills"),
    (entry) => entry.isDirectory(),
  );
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
