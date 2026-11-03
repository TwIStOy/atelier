import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { normalizePersonaId } from "@htwang-contrib/common";
import { parseWorkflowScript } from "./script.ts";

export type SavedWorkflowScope = "project" | "user";

export type SavedWorkflow = {
  name: string;
  description: string;
  script: string;
  sourcePath: string;
  scope: SavedWorkflowScope;
};

function savedWorkflowDirs(cwd: string, home: string = homedir()): Array<{ dir: string; scope: SavedWorkflowScope }> {
  return [
    { dir: path.join(home, ".config", "pi", "workflows"), scope: "user" },
    { dir: path.join(cwd, ".pi", "workflows"), scope: "project" },
  ];
}

function savedWorkflowDirForScope(cwd: string, scope: SavedWorkflowScope, home: string = homedir()): string {
  return scope === "project" ? path.join(cwd, ".pi", "workflows") : path.join(home, ".config", "pi", "workflows");
}

export function normalizeWorkflowCommandName(raw: string): string {
  return normalizePersonaId(raw);
}

function loadSavedWorkflowFile(file: string, scope: SavedWorkflowScope): SavedWorkflow | null {
  let script: string;
  try {
    script = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const parsed = parseWorkflowScript(script);
  if (!parsed.ok) return null;
  const name =
    normalizeWorkflowCommandName(parsed.script.meta.name) || normalizeWorkflowCommandName(path.basename(file, ".js"));
  if (!name) return null;
  return {
    name,
    description: parsed.script.meta.description,
    script,
    sourcePath: file,
    scope,
  };
}

export function listSavedWorkflows(cwd: string, home?: string): SavedWorkflow[] {
  const byName = new Map<string, SavedWorkflow>();
  for (const { dir, scope } of savedWorkflowDirs(cwd, home)) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".js")) continue;
      const file = path.join(dir, entry);
      try {
        if (!fs.statSync(file).isFile()) continue;
      } catch {
        continue;
      }
      const saved = loadSavedWorkflowFile(file, scope);
      if (saved) byName.set(saved.name, saved);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function assertNoSymlink(target: string): void {
  try {
    if (fs.lstatSync(target).isSymbolicLink()) {
      throw new Error(`refusing to write through symlink: ${target}`);
    }
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw e;
  }
}

export function saveWorkflowScript(
  name: string,
  script: string,
  scope: SavedWorkflowScope,
  cwd: string,
  home?: string,
): { name: string; path: string } {
  const normalized = normalizeWorkflowCommandName(name);
  if (!normalized) {
    throw new Error(`invalid workflow command name: ${name}`);
  }
  const parsed = parseWorkflowScript(script);
  if (!parsed.ok) {
    throw new Error(`cannot save an invalid workflow script: ${parsed.error}`);
  }
  const dir = savedWorkflowDirForScope(cwd, scope, home);
  const target = path.join(dir, `${normalized}.js`);
  assertNoSymlink(dir);
  if (fs.existsSync(target)) {
    assertNoSymlink(target);
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, script, "utf8");
  fs.renameSync(tmp, target);
  return { name: normalized, path: target };
}
