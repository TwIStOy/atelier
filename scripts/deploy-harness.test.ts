import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import fileURLToPathFn from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const fileURLToPath = fileURLToPathFn.fileURLToPath;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts", "deploy-harness.mjs");

let home: string;

function runDeploy(): void {
  execFileSync("node", [script], {
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
    stdio: "pipe",
  });
}

async function realSkills(): Promise<string[]> {
  return (await readdir(join(repoRoot, "skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

async function countEntries(dir: string, keepsFile: boolean): Promise<number> {
  return (
    await readdir(dir, { withFileTypes: true })
  ).filter((entry) => (keepsFile ? entry.name.endsWith(".md") : entry.isDirectory())).length;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "deploy-harness-test-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("deploy-harness", () => {
  it("links every repo skill into ~/.agents/skills", async () => {
    runDeploy();
    for (const name of await realSkills()) {
      const link = join(home, ".agents", "skills", name);
      const stat = await lstat(link);
      expect(stat.isSymbolicLink()).toBe(true);
      expect(await realpath(link)).toBe(join(repoRoot, "skills", name));
    }
  });

  it("links prompts-resource to the repo checkout", async () => {
    runDeploy();
    const link = join(home, ".agents", "prompts-resource");
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await realpath(link)).toBe(join(repoRoot, "prompts-resource"));
  });

  it("links opencode command shells into the opencode config dir", async () => {
    runDeploy();
    const dir = join(home, ".config", "opencode", "commands");
    const files = (await readdir(dir)).filter((name) => name.endsWith(".md"));
    const expectedCommands = await countEntries(join(repoRoot, "harness", "opencode", "commands"), true);
    expect(files.length).toBe(expectedCommands);
    for (const file of files) {
      expect(await realpath(join(dir, file))).toBe(join(repoRoot, "harness", "opencode", "commands", file));
    }
  });

  it("builds the magpie plugin bundle and symlinks it into the opencode plugins dir", async () => {
    runDeploy();
    const link = join(home, ".config", "opencode", "plugins", "magpie.js");
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await realpath(link)).toBe(join(repoRoot, "harness", "opencode", "plugins", "dist", "magpie.js"));
    const content = await readFile(link, "utf8");
    expect(content).toContain("generate_image");
  });

  it("links the repo skills into ~/.cursor/skills", async () => {
    runDeploy();
    for (const name of await realSkills()) {
      const link = join(home, ".cursor", "skills", name);
      expect((await lstat(link)).isSymbolicLink()).toBe(true);
      expect(await realpath(link)).toBe(join(repoRoot, "skills", name));
    }
  });

  it("prunes stale links into the repo harness dir without touching other entries", async () => {
    const dir = join(home, ".cursor", "skills");
    await mkdir(dir, { recursive: true });
    const staleShell = join(repoRoot, "harness", "cursor", "skills", "implement", "SKILL.md");
    await symlink(staleShell, join(dir, "implement"));
    const foreign = join(home, "elsewhere");
    await mkdir(foreign, { recursive: true });
    await symlink(foreign, join(dir, "foreign"));
    await mkdir(join(dir, "real-dir"), { recursive: true });

    runDeploy();

    await expect(lstat(join(dir, "implement"))).rejects.toThrow();
    expect(await realpath(join(dir, "foreign"))).toBe(foreign);
    expect((await lstat(join(dir, "real-dir"))).isDirectory()).toBe(true);
  });

  it("leaves the opencode config untouched", async () => {
    const configDir = join(home, ".config", "opencode");
    await mkdir(configDir, { recursive: true });
    const configPath = join(configDir, "opencode.json");
    const original = JSON.stringify({ plugin: ["/home/someone/dotcode/dist/index.js"] });
    await writeFile(configPath, original, "utf8");

    runDeploy();

    expect(await readFile(configPath, "utf8")).toBe(original);
  });

  it("is idempotent and never clobbers a pre-existing real directory", async () => {
    const protectedDir = join(home, ".agents", "skills", "terminal-browser");
    await mkdir(protectedDir, { recursive: true });
    await writeFile(join(protectedDir, "marker.txt"), "keep", "utf8");

    runDeploy();
    runDeploy();

    const marker = await readFile(join(protectedDir, "marker.txt"), "utf8");
    expect(marker).toBe("keep");
    expect((await lstat(protectedDir)).isSymbolicLink()).toBe(false);
    for (const name of await realSkills()) {
      expect((await lstat(join(home, ".agents", "skills", name))).isSymbolicLink()).toBe(true);
    }
  });
});
