import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { SessionLifecycle } from "@htwang-contrib/common";
import type { StatusLineComponent } from "./base.ts";

interface VersionCommand {
  cmd: string;
  args: string[];
  pattern: RegExp;
}

interface RuntimeDef {
  name: string;
  files?: string[];
  folders?: string[];
  env?: string;
  version?: VersionCommand;
}

/**
 * Detection matrix ordered by likelihood. First match wins. Matching is by
 * file/folder presence or env var — no process spawn for detection itself.
 * Add entries here to extend coverage.
 */
const RUNTIMES: RuntimeDef[] = [
  {
    name: "node",
    files: ["package.json", ".nvmrc", ".node-version"],
    version: { cmd: "node", args: ["--version"], pattern: /v(\d+\.\d+\.\d+)/ },
  },
  {
    name: "python",
    files: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile", ".python-version"],
    version: { cmd: "python3", args: ["--version"], pattern: /Python (\d+\.\d+\.\d+)/ },
  },
  {
    name: "rust",
    files: ["Cargo.toml"],
    version: { cmd: "rustc", args: ["--version"], pattern: /rustc (\d+\.\d+\.\d+)/ },
  },
  { name: "go", files: ["go.mod"], version: { cmd: "go", args: ["version"], pattern: /go(\d+\.\d+\.\d+)/ } },
  {
    name: "ruby",
    files: ["Gemfile", ".ruby-version"],
    version: { cmd: "ruby", args: ["--version"], pattern: /ruby (\d+\.\d+\.\d+)/ },
  },
  {
    name: "deno",
    files: ["deno.json", "deno.jsonc", "deno.lock"],
    version: { cmd: "deno", args: ["--version"], pattern: /deno (\d+\.\d+\.\d+)/ },
  },
  {
    name: "bun",
    files: ["bun.lock", "bun.lockb"],
    version: { cmd: "bun", args: ["--version"], pattern: /(\d+\.\d+\.\d+)/ },
  },
  {
    name: "php",
    files: ["composer.json"],
    version: { cmd: "php", args: ["--version"], pattern: /PHP (\d+\.\d+\.\d+)/ },
  },
  {
    name: "swift",
    files: ["Package.swift"],
    version: { cmd: "swift", args: ["--version"], pattern: /Swift (\d+\.\d+)/ },
  },
  { name: "kotlin", files: ["settings.gradle.kts"] },
  {
    name: "java",
    files: ["pom.xml", "build.gradle", "build.gradle.kts"],
    version: { cmd: "java", args: ["-version"], pattern: /version "(\d+[\d.]*)"/ },
  },
  { name: "cpp", files: ["CMakeLists.txt", "Makefile"] },
  { name: "c", files: ["Makefile", "CMakeLists.txt"] },
  {
    name: "dotnet",
    files: [".csproj", ".fsproj", "global.json", "Directory.Build.props"],
    version: { cmd: "dotnet", args: ["--version"], pattern: /(\d+\.\d+\.\d+)/ },
  },
  {
    name: "elixir",
    files: ["mix.exs"],
    version: { cmd: "elixir", args: ["--version"], pattern: /Elixir (\d+\.\d+\.\d+)/ },
  },
  {
    name: "haskell",
    files: ["stack.yaml", "cabal.project"],
    version: { cmd: "ghc", args: ["--version"], pattern: /(\d+\.\d+\.\d+)/ },
  },
  { name: "dart", files: ["pubspec.yaml"], version: { cmd: "dart", args: ["--version"], pattern: /(\d+\.\d+\.\d+)/ } },
  { name: "zig", files: ["build.zig"], version: { cmd: "zig", args: ["version"], pattern: /(\d+\.\d+\.\d+)/ } },
  {
    name: "julia",
    files: ["Project.toml", "Manifest.toml"],
    version: { cmd: "julia", args: ["--version"], pattern: /julia (\d+\.\d+\.\d+)/ },
  },
  { name: "lua", files: [".luarc.json", "stylua.toml"] },
  { name: "nim", files: ["nim.cfg"] },
  { name: "scala", files: ["build.sbt"] },
  { name: "clojure", files: ["deps.edn", "project.clj"] },
  {
    name: "gleam",
    files: ["gleam.toml"],
    version: { cmd: "gleam", args: ["--version"], pattern: /gleam (\d+\.\d+\.\d+)/ },
  },
  { name: "crystal", files: ["shard.yml"] },
  { name: "perl", files: ["Makefile.PL", "cpanfile"] },
  { name: "nix", files: ["flake.nix", "shell.nix", "default.nix"], env: "IN_NIX_SHELL" },
  { name: "terraform", files: ["main.tf", "variables.tf"], folders: [".terraform"] },
  { name: "helm", files: ["Chart.yaml", "helmfile.yaml"] },
  { name: "pulumi", files: ["Pulumi.yaml", "Pulumi.yml"] },
];

const REFRESH_INTERVAL_MS = 10_000;
const VERSION_TIMEOUT_MS = 2500;

interface CacheEntry {
  fingerprint: string;
  name: string | null;
}

/** Pure detection: first runtime whose files/folders/env match, else null. */
export function detectRuntime(cwd: string): string | null {
  for (const def of RUNTIMES) {
    if (matches(def, cwd)) return def.name;
  }
  return null;
}

function matches(def: RuntimeDef, cwd: string): boolean {
  if (def.files?.some((f) => existsSync(`${cwd}/${f}`))) return true;
  if (def.folders?.some((d) => existsSync(`${cwd}/${d}`))) return true;
  if (def.env && process.env[def.env]) return true;
  return false;
}

export function fingerprint(cwd: string): string {
  const found: string[] = [];
  for (const def of RUNTIMES) {
    for (const f of def.files ?? []) {
      if (existsSync(`${cwd}/${f}`)) found.push(f);
    }
    for (const d of def.folders ?? []) {
      if (existsSync(`${cwd}/${d}`)) found.push(d);
    }
    if (def.env && process.env[def.env]) found.push(`env:${def.env}`);
  }
  return found.sort().join(",");
}

function defForName(name: string): RuntimeDef | undefined {
  return RUNTIMES.find((r) => r.name === name);
}

export class RuntimeComponent implements StatusLineComponent {
  private name: string | null = null;
  private version: string | null = null;
  private versionFetched = false;
  private refreshing = false;
  private requestRender: (() => void) | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private cache: CacheEntry | null = null;
  private readonly versionCache = new Map<string, string>();

  constructor(
    private readonly cwd: string,
    private readonly lifecycle: SessionLifecycle,
  ) {}

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
    if (this.disposed || this.refreshing) return;
    this.refreshing = true;

    const fingerprintNow = fingerprint(this.cwd);
    if (!this.cache || this.cache.fingerprint !== fingerprintNow) {
      this.cache = { fingerprint: fingerprintNow, name: detectRuntime(this.cwd) };
      this.name = this.cache.name;
      this.version = null;
      this.versionFetched = false;
    }

    const name = this.name;
    if (name && !this.versionFetched) {
      this.versionFetched = true;
      const cached = this.versionCache.get(name);
      if (cached !== undefined) {
        this.version = cached;
      } else {
        const gen = this.lifecycle.currentGeneration();
        const fetched = await this.fetchVersion(name);
        if (!this.lifecycle.isCurrent(gen) || this.disposed) {
          this.refreshing = false;
          return;
        }
        this.version = fetched;
        if (fetched) this.versionCache.set(name, fetched);
      }
    }

    this.refreshing = false;
    if (this.disposed) return;
    this.requestRender?.();
    this.scheduleRefresh(REFRESH_INTERVAL_MS);
  }

  private async fetchVersion(name: string): Promise<string | null> {
    const def = defForName(name);
    if (!def?.version) return null;
    const { cmd, args, pattern } = def.version;
    const output = await this.spawn(cmd, args);
    if (output === null) return null;
    const match = pattern.exec(output);
    return match ? `${name} ${match[1]}` : name;
  }

  private spawn(cmd: string, args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      execFile(cmd, args, { timeout: VERSION_TIMEOUT_MS, encoding: "utf-8" }, (err, stdout, stderr) => {
        if (err) {
          resolve(null);
          return;
        }
        resolve(`${stdout}\n${stderr}`);
      });
    });
  }

  render(width: number, theme: Theme): string[] {
    if (!this.name) return [];
    const label = this.version ?? this.name;
    const text = theme.fg("muted", truncateToWidth(label, width, "…"));
    return [truncateToWidth(text, width, "")];
  }
}
