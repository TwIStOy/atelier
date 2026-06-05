import { existsSync, statSync, readFileSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";

export interface SnippetSource {
  dir: string;
  source: string;
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readSettingsPackages(settingsPath: string): string[] {
  const data = readJsonFile(settingsPath);
  if (!data || !Array.isArray(data.packages)) {
    return [];
  }
  return data.packages.filter((p): p is string => typeof p === "string");
}

const NPM_PREFIX = "npm:";
const GIT_PREFIX = "git:";

function parseNpmName(spec: string): string {
  const firstSlash = spec.indexOf("/");
  if (spec.startsWith("@") && firstSlash > 0) {
    const atIdx = spec.indexOf("@", 1);
    return atIdx > 0 ? spec.slice(0, atIdx) : spec;
  }
  const atIdx = spec.indexOf("@");
  return atIdx > 0 ? spec.slice(0, atIdx) : spec;
}

function resolveGitPath(gitSpec: string, baseDir: string): string {
  const urlPart = gitSpec.trim();
  const atIdx = urlPart.indexOf("/");
  if (atIdx < 0) return "";
  const host = urlPart.slice(0, atIdx);
  let repoPath = urlPart.slice(atIdx + 1);
  const refIdx = repoPath.lastIndexOf("@");
  if (refIdx >= 0) {
    repoPath = repoPath.slice(0, refIdx);
  }
  if (!repoPath) return "";
  return join(baseDir, "git", host, repoPath);
}

export function resolvePackages(packages: string[], baseDir: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of packages) {
    let absPath: string;

    if (entry.startsWith(NPM_PREFIX)) {
      const name = parseNpmName(entry.slice(NPM_PREFIX.length).trim());
      absPath = join(baseDir, "npm", "node_modules", name);
    } else if (entry.startsWith(GIT_PREFIX)) {
      absPath = resolveGitPath(entry.slice(GIT_PREFIX.length), baseDir);
      if (!absPath) continue;
    } else {
      absPath = resolve(baseDir, entry);
    }

    if (seen.has(absPath)) continue;
    seen.add(absPath);
    if (!existsSync(absPath)) continue;
    const stat = statSync(absPath);
    if (!stat.isDirectory()) continue;
    result.push(absPath);
  }

  return result;
}

export function readPiSnippets(packageRoot: string): string[] {
  const data = readJsonFile(join(packageRoot, "package.json"));
  if (!data) return [];
  const pi = data.pi;
  if (typeof pi !== "object" || pi === null) return [];
  const piObj = pi as Record<string, unknown>;
  if (!Array.isArray(piObj.snippets)) return [];
  return piObj.snippets.filter((s): s is string => typeof s === "string");
}

export function readPkgName(packageRoot: string): string {
  const data = readJsonFile(join(packageRoot, "package.json"));
  if (data && typeof data.name === "string") {
    return data.name;
  }
  return basename(packageRoot);
}

export function expandExtensionSubpackages(packageRoot: string): string[] {
  const data = readJsonFile(join(packageRoot, "package.json"));
  if (!data) return [];
  const pi = data.pi;
  if (typeof pi !== "object" || pi === null) return [];
  const piObj = pi as Record<string, unknown>;
  if (!Array.isArray(piObj.extensions)) return [];

  const result: string[] = [];
  for (const entry of piObj.extensions) {
    if (typeof entry !== "string") continue;
    const absPath = resolve(packageRoot, entry);
    let targetDir: string;
    if (existsSync(absPath) && statSync(absPath).isFile()) {
      targetDir = dirname(absPath);
    } else {
      targetDir = absPath;
    }
    if (existsSync(join(targetDir, "package.json"))) {
      result.push(targetDir);
    }
  }
  return result;
}

export function collectSnippetDirs(
  cwd: string,
  agentDir: string,
): SnippetSource[] {
  const dirs: SnippetSource[] = [];

  const userSnippetsDir = join(agentDir, "snippets");
  if (existsSync(userSnippetsDir) && statSync(userSnippetsDir).isDirectory()) {
    dirs.push({ dir: userSnippetsDir, source: "user" });
  }

  const userSettingsPath = join(agentDir, "settings.json");
  const userPackages = resolvePackages(
    readSettingsPackages(userSettingsPath),
    dirname(userSettingsPath),
  );
  for (const pkgRoot of userPackages) {
    const snippets = readPiSnippets(pkgRoot);
    const pkgName = readPkgName(pkgRoot);
    for (const entry of snippets) {
      const dir = resolve(pkgRoot, entry);
      if (existsSync(dir) && statSync(dir).isDirectory()) {
        dirs.push({ dir, source: `package:${pkgName}` });
      }
    }

    const subPackages = expandExtensionSubpackages(pkgRoot);
    for (const subPkg of subPackages) {
      const subSnippets = readPiSnippets(subPkg);
      const subName = readPkgName(subPkg);
      for (const entry of subSnippets) {
        const dir = resolve(subPkg, entry);
        if (existsSync(dir) && statSync(dir).isDirectory()) {
          dirs.push({ dir, source: `package:${subName}` });
        }
      }
    }
  }

  const projectSnippetsDir = join(cwd, ".pi", "snippets");
  if (
    existsSync(projectSnippetsDir) &&
    statSync(projectSnippetsDir).isDirectory()
  ) {
    dirs.push({ dir: projectSnippetsDir, source: "project" });
  }

  const projectSettingsPath = join(cwd, ".pi", "settings.json");
  const projectPackages = resolvePackages(
    readSettingsPackages(projectSettingsPath),
    dirname(projectSettingsPath),
  );
  for (const pkgRoot of projectPackages) {
    const snippets = readPiSnippets(pkgRoot);
    const pkgName = readPkgName(pkgRoot);
    for (const entry of snippets) {
      const dir = resolve(pkgRoot, entry);
      if (existsSync(dir) && statSync(dir).isDirectory()) {
        dirs.push({ dir, source: `package:${pkgName}` });
      }
    }

    const subPackages = expandExtensionSubpackages(pkgRoot);
    for (const subPkg of subPackages) {
      const subSnippets = readPiSnippets(subPkg);
      const subName = readPkgName(subPkg);
      for (const entry of subSnippets) {
        const dir = resolve(subPkg, entry);
        if (existsSync(dir) && statSync(dir).isDirectory()) {
          dirs.push({ dir, source: `package:${subName}` });
        }
      }
    }
  }

  const rootPkgData = readJsonFile(join(cwd, "package.json"));
  if (rootPkgData) {
    const pi = rootPkgData.pi;
    if (typeof pi === "object" && pi !== null) {
      const piObj = pi as Record<string, unknown>;
      if (Array.isArray(piObj.extensions)) {
        for (const entry of piObj.extensions) {
          if (typeof entry !== "string") continue;
          const absPath = resolve(cwd, entry);
          let targetDir: string;
          if (existsSync(absPath) && statSync(absPath).isFile()) {
            targetDir = dirname(absPath);
          } else {
            targetDir = absPath;
          }
          if (!existsSync(join(targetDir, "package.json"))) continue;
          const subSnippets = readPiSnippets(targetDir);
          const subName = readPkgName(targetDir);
          for (const snippetEntry of subSnippets) {
            const dir = resolve(targetDir, snippetEntry);
            if (existsSync(dir) && statSync(dir).isDirectory()) {
              dirs.push({ dir, source: `package:${subName}` });
            }
          }
        }
      }
    }
  }

  return dirs;
}
