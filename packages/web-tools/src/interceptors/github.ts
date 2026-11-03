import { execFile } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  type Stats,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, sep as pathSep, resolve as resolvePath } from "node:path";
import { createLogger } from "@htwang-contrib/common";
import type { FetchResponse } from "../providers/types.ts";
import type { UrlInterceptor } from "./types.ts";

const logger = createLogger("web-tools");

const MAX_TREE_ENTRIES = 200;
const MAX_INLINE_FILE_CHARS = 100_000;

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".webp",
  ".svg",
  ".tiff",
  ".tif",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".mkv",
  ".flv",
  ".wmv",
  ".wav",
  ".ogg",
  ".webm",
  ".flac",
  ".aac",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".zst",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".o",
  ".a",
  ".lib",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".sqlite",
  ".db",
  ".sqlite3",
  ".pyc",
  ".pyo",
  ".class",
  ".jar",
  ".war",
  ".iso",
  ".img",
  ".dmg",
]);

const NOISE_DIRS = new Set([
  "node_modules",
  "vendor",
  ".next",
  "dist",
  "build",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  "target",
  ".gradle",
  ".idea",
  ".vscode",
]);

const NON_CODE_SEGMENTS = new Set([
  "issues",
  "pull",
  "pulls",
  "discussions",
  "releases",
  "wiki",
  "actions",
  "settings",
  "security",
  "projects",
  "graphs",
  "compare",
  "commits",
  "tags",
  "branches",
  "stargazers",
  "watchers",
  "network",
  "forks",
  "milestone",
  "labels",
  "packages",
  "codespaces",
  "contribute",
  "community",
  "sponsors",
  "invitations",
  "notifications",
  "insights",
]);

export interface GitHubUrlInfo {
  owner: string;
  repo: string;
  ref?: string;
  refIsFullSha: boolean;
  path?: string;
  type: "root" | "blob" | "tree";
}

function tryParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isGitHubHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "github.com" || host === "www.github.com";
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function decodeUrlSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map(decodeSegment);
}

function isNoiseSegment(segment: string | undefined): boolean {
  return segment !== undefined && NON_CODE_SEGMENTS.has(segment.toLowerCase());
}

function joinPathParts(pathParts: string[]): string {
  return pathParts.length > 0 ? pathParts.join("/") : "";
}

function parseBlobOrTreeInfo(owner: string, repo: string, segments: string[]): GitHubUrlInfo | null {
  const action = segments[2];
  if (action !== "blob" && action !== "tree") return null;
  if (segments.length < 4) return null;
  const ref = segments[3]!;
  return {
    owner,
    repo,
    ref,
    refIsFullSha: /^[0-9a-f]{40}$/.test(ref),
    path: joinPathParts(segments.slice(4)),
    type: action as "blob" | "tree",
  };
}

function parseRepoUrlInfo(segments: string[]): GitHubUrlInfo | null {
  if (segments.length < 2) return null;
  const owner = segments[0]!;
  const repo = segments[1]!.replace(/\.git$/, "");
  if (isNoiseSegment(segments[2])) return null;
  if (segments.length === 2) {
    return { owner, repo, refIsFullSha: false, type: "root" };
  }
  return parseBlobOrTreeInfo(owner, repo, segments);
}

function parseGitHubUrl(url: string): GitHubUrlInfo | null {
  const parsed = tryParseUrl(url);
  if (!parsed) return null;
  if (!isGitHubHost(parsed.hostname)) return null;
  return parseRepoUrlInfo(decodeUrlSegments(parsed.pathname));
}

export interface GitHubInterceptorOptions {
  enabled?: boolean;
  maxRepoSizeMB?: number;
  cloneTimeoutSeconds?: number;
  clonePath?: string;
}

interface ResolvedGitHubOptions {
  enabled: boolean;
  maxRepoSizeMB: number;
  cloneTimeoutSeconds: number;
  clonePath: string;
}

const GITHUB_INTERCEPTOR_DEFAULTS: ResolvedGitHubOptions = {
  enabled: false,
  maxRepoSizeMB: 350,
  cloneTimeoutSeconds: 30,
  clonePath: join(tmpdir(), "pi-github-repos"),
};

export interface CachedClone {
  localPath: string;
  clonePromise: Promise<string | null>;
}

function cacheKey(owner: string, repo: string, ref?: string): string {
  return ref ? `${owner}/${repo}@${ref}` : `${owner}/${repo}`;
}

function cloneDir(clonePath: string, owner: string, repo: string, ref?: string): string {
  const dirName = ref ? `${repo}@${ref}` : repo;
  return join(clonePath, owner, dirName);
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function withDefault<T>(value: T | undefined, fallback: T): T {
  return value ?? fallback;
}

function resolveGitHubOptions(opts: GitHubInterceptorOptions): ResolvedGitHubOptions {
  return {
    enabled: withDefault(opts.enabled, GITHUB_INTERCEPTOR_DEFAULTS.enabled),
    maxRepoSizeMB: withDefault(opts.maxRepoSizeMB, GITHUB_INTERCEPTOR_DEFAULTS.maxRepoSizeMB),
    cloneTimeoutSeconds: withDefault(opts.cloneTimeoutSeconds, GITHUB_INTERCEPTOR_DEFAULTS.cloneTimeoutSeconds),
    clonePath: withDefault(opts.clonePath, GITHUB_INTERCEPTOR_DEFAULTS.clonePath),
  };
}

function removeDir(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function ghCloneArgs(owner: string, repo: string, localPath: string, ref: string | undefined): string[] {
  const args = ["gh", "repo", "clone", `${owner}/${repo}`, localPath, "--", "--depth", "1", "--single-branch"];
  if (ref) args.push("--branch", ref);
  return args;
}

function gitCloneArgs(owner: string, repo: string, localPath: string, ref: string | undefined): string[] {
  const gitUrl = `https://github.com/${owner}/${repo}.git`;
  const args = ["git", "clone", "--depth", "1", "--single-branch"];
  if (ref) args.push("--branch", ref);
  args.push(gitUrl, localPath);
  return args;
}

function apiViewHeaderLines(sizeNote: string | undefined): string[] {
  if (!sizeNote) return [];
  return [sizeNote, ""];
}

function apiFileContentLines(content: string): string[] {
  if (content.length > MAX_INLINE_FILE_CHARS) {
    return [content.slice(0, MAX_INLINE_FILE_CHARS), "\n[File truncated at 100K chars]"];
  }
  return [content];
}

function pushOptionalSection(lines: string[], heading: string, value: string | null): void {
  if (!value) return;
  lines.push(heading);
  lines.push(value);
  lines.push("");
}

function repoTitle(owner: string, repo: string, path: string | undefined): string {
  return path ? `${owner}/${repo} - ${path}` : `${owner}/${repo}`;
}

function cloneContentResponse(localPath: string, owner: string, repo: string, info: GitHubUrlInfo): FetchResponse {
  const text = generateCloneContent(localPath, info);
  const title = repoTitle(owner, repo, info.path);
  return { text, title, contentType: "text/plain" };
}

export class GitHubInterceptor implements UrlInterceptor {
  readonly name = "github";

  private readonly options: ResolvedGitHubOptions;
  private ghAvailable: boolean | null = null;
  private ghHintShown = false;
  private readonly cloneCache: Map<string, CachedClone>;

  constructor(
    opts: GitHubInterceptorOptions & {
      cloneCache?: Map<string, CachedClone>;
    } = {},
  ) {
    const { cloneCache, ...rest } = opts;
    this.options = resolveGitHubOptions(rest);
    this.cloneCache = cloneCache ?? new Map();
  }

  async intercept(url: string, opts: { raw: boolean; signal?: AbortSignal }): Promise<FetchResponse | null> {
    return this.fetchGitHub(url, opts.signal);
  }

  async checkGhAvailable(): Promise<boolean> {
    if (this.ghAvailable !== null) return this.ghAvailable;
    return new Promise((resolve) => {
      execFile("gh", ["--version"], { timeout: 5000 }, (err) => {
        this.ghAvailable = !err;
        resolve(this.ghAvailable as boolean);
      });
    });
  }

  private async ghQuery<T>(
    args: string[],
    options: { timeout: number; maxBuffer?: number },
    handle: (stdout: string) => T | null,
  ): Promise<T | null> {
    if (!(await this.checkGhAvailable())) return null;
    return new Promise((resolve) => {
      execFile("gh", args, options, (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        try {
          resolve(handle(stdout));
        } catch {
          resolve(null);
        }
      });
    });
  }

  private async checkRepoSize(owner: string, repo: string): Promise<number | null> {
    return this.ghQuery(["api", `repos/${owner}/${repo}`, "--jq", ".size"], { timeout: 10000 }, (out) => {
      const kb = Number.parseInt(out.trim(), 10);
      return Number.isNaN(kb) ? null : kb;
    });
  }

  private showGhHint(): void {
    if (!this.ghHintShown) {
      this.ghHintShown = true;
      logger.warn("Install `gh` CLI for better GitHub repo access including private repos.");
    }
  }

  private async getDefaultBranch(owner: string, repo: string): Promise<string | null> {
    return this.ghQuery(
      ["api", `repos/${owner}/${repo}`, "--jq", ".default_branch"],
      { timeout: 10000 },
      (out) => out.trim() || null,
    );
  }

  private fetchTreeViaApi(owner: string, repo: string, ref: string): Promise<string | null> {
    return this.ghQuery(
      ["api", `repos/${owner}/${repo}/git/trees/${ref}?recursive=1`, "--jq", ".tree[].path"],
      { timeout: 15000, maxBuffer: 5 * 1024 * 1024 },
      (out) => {
        const paths = out.trim().split("\n").filter(Boolean);
        if (paths.length === 0) return null;
        const truncated = paths.length > MAX_TREE_ENTRIES;
        const display = paths.slice(0, MAX_TREE_ENTRIES).join("\n");
        return truncated ? `${display}\n... (${paths.length} total entries)` : display;
      },
    );
  }

  private async fetchReadmeViaApi(owner: string, repo: string, ref: string): Promise<string | null> {
    return this.ghQuery(
      ["api", `repos/${owner}/${repo}/readme?ref=${ref}`, "--jq", ".content"],
      { timeout: 10000 },
      (out) => {
        const decoded = Buffer.from(out.trim(), "base64").toString("utf-8");
        return decoded.length > 8192 ? `${decoded.slice(0, 8192)}\n\n[README truncated at 8K chars]` : decoded;
      },
    );
  }

  private async fetchFileViaApi(owner: string, repo: string, path: string, ref: string): Promise<string | null> {
    return this.ghQuery(
      ["api", `repos/${owner}/${repo}/contents/${path}?ref=${ref}`, "--jq", ".content"],
      { timeout: 10000, maxBuffer: 2 * 1024 * 1024 },
      (out) => Buffer.from(out.trim(), "base64").toString("utf-8"),
    );
  }

  private async resolveApiRef(owner: string, repo: string, info: GitHubUrlInfo): Promise<string | null> {
    return info.ref || (await this.getDefaultBranch(owner, repo));
  }

  private async fetchBlobViaApi(
    owner: string,
    repo: string,
    path: string,
    ref: string,
    lines: string[],
  ): Promise<FetchResponse | null> {
    const content = await this.fetchFileViaApi(owner, repo, path, ref);
    if (!content) return null;

    lines.push(`## ${path}`);
    lines.push(...apiFileContentLines(content));

    const title = `${owner}/${repo} - ${path}`;
    return { text: lines.join("\n"), title, contentType: "text/plain" };
  }

  private async fetchRepoOverviewViaApi(
    owner: string,
    repo: string,
    info: GitHubUrlInfo,
    ref: string,
    lines: string[],
  ): Promise<FetchResponse | null> {
    const [tree, readme] = await Promise.all([
      this.fetchTreeViaApi(owner, repo, ref),
      this.fetchReadmeViaApi(owner, repo, ref),
    ]);

    if (!tree && !readme) return null;

    pushOptionalSection(lines, "## Structure", tree);
    pushOptionalSection(lines, "## README.md", readme);
    lines.push("This is an API-only view. Clone the repo or use `read`/`bash` for deeper exploration.");

    const title = repoTitle(owner, repo, info.path);
    return { text: lines.join("\n"), title, contentType: "text/plain" };
  }

  private async fetchViaApi(
    owner: string,
    repo: string,
    info: GitHubUrlInfo,
    sizeNote?: string,
  ): Promise<FetchResponse | null> {
    const ref = await this.resolveApiRef(owner, repo, info);
    if (!ref) return null;

    const lines = apiViewHeaderLines(sizeNote);

    if (info.type === "blob" && info.path) {
      return this.fetchBlobViaApi(owner, repo, info.path, ref, lines);
    }

    return this.fetchRepoOverviewViaApi(owner, repo, info, ref, lines);
  }

  private execClone(
    args: string[],
    localPath: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const child = execFile(args[0]!, args.slice(1), { timeout: timeoutMs }, (err) => {
        if (err) {
          try {
            rmSync(localPath, { recursive: true, force: true });
          } catch {
            // ignore cleanup errors
          }
          resolve(null);
          return;
        }
        resolve(localPath);
      });
      if (signal) {
        const onAbort = () => child.kill();
        signal.addEventListener("abort", onAbort, { once: true });
        child.on("exit", () => signal.removeEventListener("abort", onAbort));
      }
    });
  }

  private async cloneRepo(
    owner: string,
    repo: string,
    ref: string | undefined,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const localPath = cloneDir(this.options.clonePath, owner, repo, ref);
    removeDir(localPath);

    const timeoutMs = this.options.cloneTimeoutSeconds * 1000;

    if (await this.checkGhAvailable()) {
      return this.execClone(ghCloneArgs(owner, repo, localPath, ref), localPath, timeoutMs, signal);
    }

    this.showGhHint();
    return this.execClone(gitCloneArgs(owner, repo, localPath, ref), localPath, timeoutMs, signal);
  }

  private async awaitCachedClone(
    cached: CachedClone,
    owner: string,
    repo: string,
    info: GitHubUrlInfo,
    signal?: AbortSignal,
  ): Promise<FetchResponse | null> {
    if (isAborted(signal)) return null;
    const result = await cached.clonePromise;
    if (isAborted(signal)) return null;
    if (result) {
      return cloneContentResponse(result, owner, repo, info);
    }
    return this.fetchViaApi(owner, repo, info);
  }

  private async fetchShaViaApi(
    owner: string,
    repo: string,
    info: GitHubUrlInfo,
    signal?: AbortSignal,
  ): Promise<FetchResponse | null> {
    if (isAborted(signal)) return null;
    const sizeNote = "Note: Commit SHA URLs use the GitHub API instead of cloning.";
    return this.fetchViaApi(owner, repo, info, sizeNote);
  }

  private async fetchRepo(
    owner: string,
    repo: string,
    info: GitHubUrlInfo,
    key: string,
    signal?: AbortSignal,
  ): Promise<FetchResponse | null> {
    const cached = this.cloneCache.get(key);
    if (cached) {
      return this.awaitCachedClone(cached, owner, repo, info, signal);
    }
    if (info.refIsFullSha) {
      return this.fetchShaViaApi(owner, repo, info, signal);
    }
    return this.fetchRepoByClone(owner, repo, info, key, signal);
  }

  private oversizedRepoSizeMB(sizeKB: number | null): number | null {
    if (sizeKB === null) return null;
    const sizeMB = sizeKB / 1024;
    return sizeMB > this.options.maxRepoSizeMB ? sizeMB : null;
  }

  private async fetchOversizedRepoViaApi(
    owner: string,
    repo: string,
    info: GitHubUrlInfo,
    sizeMB: number,
    signal?: AbortSignal,
  ): Promise<FetchResponse | null> {
    if (isAborted(signal)) return null;
    const sizeNote =
      `Note: Repository is ${Math.round(sizeMB)}MB (threshold: ${this.options.maxRepoSizeMB}MB). ` +
      `Showing API-fetched content instead of full clone.`;
    return this.fetchViaApi(owner, repo, info, sizeNote);
  }

  private async fetchRepoByClone(
    owner: string,
    repo: string,
    info: GitHubUrlInfo,
    key: string,
    signal?: AbortSignal,
  ): Promise<FetchResponse | null> {
    const sizeKB = await this.checkRepoSize(owner, repo);
    if (isAborted(signal)) return null;
    const oversizedMB = this.oversizedRepoSizeMB(sizeKB);
    if (oversizedMB !== null) {
      return this.fetchOversizedRepoViaApi(owner, repo, info, oversizedMB, signal);
    }
    if (isAborted(signal)) return null;
    return this.fetchViaClone(owner, repo, info, key, signal);
  }

  private async startClone(
    owner: string,
    repo: string,
    info: GitHubUrlInfo,
    key: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const clonePromise = this.cloneRepo(owner, repo, info.ref, signal);
    const localPath = cloneDir(this.options.clonePath, owner, repo, info.ref);
    this.cloneCache.set(key, { localPath, clonePromise });
    return clonePromise;
  }

  private async cloneFailedResponse(
    owner: string,
    repo: string,
    info: GitHubUrlInfo,
    key: string,
    signal?: AbortSignal,
  ): Promise<FetchResponse | null> {
    this.cloneCache.delete(key);
    if (isAborted(signal)) return null;
    return this.fetchViaApi(owner, repo, info);
  }

  private async settleCloneResult(
    result: string | null,
    owner: string,
    repo: string,
    info: GitHubUrlInfo,
    key: string,
    signal?: AbortSignal,
  ): Promise<FetchResponse | null> {
    if (isAborted(signal)) {
      if (!result) this.cloneCache.delete(key);
      return null;
    }
    if (!result) {
      return this.cloneFailedResponse(owner, repo, info, key, signal);
    }
    return cloneContentResponse(result, owner, repo, info);
  }

  private async fetchViaClone(
    owner: string,
    repo: string,
    info: GitHubUrlInfo,
    key: string,
    signal?: AbortSignal,
  ): Promise<FetchResponse | null> {
    const cachedAfterCheck = this.cloneCache.get(key);
    if (cachedAfterCheck) {
      return this.awaitCachedClone(cachedAfterCheck, owner, repo, info, signal);
    }
    const result = await this.startClone(owner, repo, info, key, signal);
    return this.settleCloneResult(result, owner, repo, info, key, signal);
  }

  private async fetchGitHub(url: string, signal?: AbortSignal): Promise<FetchResponse | null> {
    const info = parseGitHubUrl(url);
    if (!info || isAborted(signal) || !this.options.enabled) return null;

    const { owner, repo } = info;
    const key = cacheKey(owner, repo, info.ref);
    return this.fetchRepo(owner, repo, info, key, signal);
  }
}

// ---------------------------------------------------------------------------
// Clone content generation (pure functions)
// ---------------------------------------------------------------------------

function hasBinaryExtension(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function openReadOnly(filePath: string): number | null {
  try {
    return openSync(filePath, "r");
  } catch {
    return null;
  }
}

function bufferHasNullByte(buf: Buffer, bytesRead: number): boolean {
  for (let i = 0; i < bytesRead; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function first512BytesContainNull(fd: number): boolean {
  try {
    const buf = Buffer.alloc(512);
    const bytesRead = readSync(fd, buf, 0, 512, 0);
    return bufferHasNullByte(buf, bytesRead);
  } catch {
    return false;
  }
}

function probeForNullByte(filePath: string): boolean {
  const fd = openReadOnly(filePath);
  if (fd === null) return false;
  try {
    return first512BytesContainNull(fd);
  } finally {
    closeSync(fd);
  }
}

function isBinaryFile(filePath: string): boolean {
  if (hasBinaryExtension(filePath)) return true;
  return probeForNullByte(filePath);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pathPrefix(path: string): string {
  return path.endsWith(pathSep) ? path : path + pathSep;
}

function isWithinPrefix(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(pathPrefix(root));
}

function verifyRealPaths(normalizedRoot: string, candidate: string): string | null {
  try {
    const realRoot = realpathSync(normalizedRoot);
    const realCandidate = realpathSync(candidate);
    if (realCandidate === realRoot) return candidate;
    return isWithinPrefix(realCandidate, realRoot) ? candidate : null;
  } catch {
    return null;
  }
}

function resolveWithinRepo(rootPath: string, relativePath: string): string | null {
  const normalizedRoot = resolvePath(rootPath);
  const candidate = resolvePath(normalizedRoot, relativePath);
  if (!isWithinPrefix(candidate, normalizedRoot)) return null;
  if (!existsSync(candidate)) return candidate;
  return verifyRealPaths(normalizedRoot, candidate);
}

function readDirEntries(dir: string): string[] | null {
  try {
    return readdirSync(dir).sort();
  } catch {
    return null;
  }
}

function buildTree(rootPath: string): string {
  const entries: string[] = [];

  function walkItems(items: string[], relPath: string): void {
    for (const item of items) {
      if (entries.length >= MAX_TREE_ENTRIES) return;
      visit(item, relPath);
    }
  }

  function visit(item: string, relPath: string): void {
    if (item === ".git") return;
    const rel = relPath ? `${relPath}/${item}` : item;
    const safePath = resolveWithinRepo(rootPath, rel);
    if (!safePath) {
      entries.push(`${rel}  [outside repo skipped]`);
      return;
    }
    visitSafeEntry(item, rel, safePath);
  }

  function visitSafeEntry(item: string, rel: string, safePath: string): void {
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(safePath);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      if (NOISE_DIRS.has(item)) {
        entries.push(`${rel}/  [skipped]`);
        return;
      }
      entries.push(`${rel}/`);
      walk(safePath, rel);
      return;
    }
    entries.push(rel);
  }

  function walk(dir: string, relPath: string): void {
    if (entries.length >= MAX_TREE_ENTRIES) return;
    const items = readDirEntries(dir);
    if (items === null) return;
    walkItems(items, relPath);
  }

  walk(rootPath, "");
  if (entries.length >= MAX_TREE_ENTRIES) {
    entries.push(`... (truncated at ${MAX_TREE_ENTRIES} entries)`);
  }
  return entries.join("\n");
}

function describeSafeDirEntry(item: string, safePath: string): string {
  try {
    const stat = statSync(safePath);
    return stat.isDirectory() ? `  ${item}/` : `  ${item}  (${formatFileSize(stat.size)})`;
  } catch {
    return `  ${item}  (unreadable)`;
  }
}

function describeDirEntry(rootPath: string, subPath: string, item: string): string {
  const rel = subPath ? `${subPath}/${item}` : item;
  const safePath = resolveWithinRepo(rootPath, rel);
  if (!safePath) return `  ${item}  (outside repo)`;
  return describeSafeDirEntry(item, safePath);
}

function listDirEntries(rootPath: string, subPath: string, items: string[]): string[] {
  const lines: string[] = [];
  for (const item of items) {
    if (item === ".git") continue;
    lines.push(describeDirEntry(rootPath, subPath, item));
  }
  return lines;
}

function buildDirListing(rootPath: string, subPath: string): string {
  const targetPath = resolveWithinRepo(rootPath, subPath);
  if (!targetPath) return "(path escapes repository root)";
  const items = readDirEntries(targetPath);
  if (items === null) return "(directory not readable)";
  return listDirEntries(rootPath, subPath, items).join("\n");
}

function readReadmeFile(readmePath: string): string | null {
  if (!existsSync(readmePath)) return null;
  try {
    const content = readFileSync(readmePath, "utf-8");
    return content.length > 8192 ? `${content.slice(0, 8192)}\n\n[README truncated at 8K chars]` : content;
  } catch {
    // skip
  }
  return null;
}

function readReadme(localPath: string): string | null {
  const candidates = ["README.md", "readme.md", "README", "README.txt", "README.rst"];
  for (const name of candidates) {
    const content = readReadmeFile(join(localPath, name));
    if (content !== null) return content;
  }
  return null;
}

function pushExploreFurther(lines: string[]): void {
  lines.push("");
  lines.push("Use `read` and `bash` tools at the path above to explore further.");
}

function rootCloneContent(localPath: string, lines: string[]): string {
  lines.push("## Structure");
  lines.push(buildTree(localPath));
  lines.push("");
  const readme = readReadme(localPath);
  if (readme) {
    lines.push("## README.md");
    lines.push(readme);
    lines.push("");
  }
  lines.push("Use `read` and `bash` tools at the path above to explore further.");
  return lines.join("\n");
}

function missingPathCloneContent(localPath: string, dirPath: string, lines: string[]): string {
  lines.push(`Path \`${dirPath}\` not found in clone. Showing repository root instead.`);
  lines.push("");
  lines.push("## Structure");
  lines.push(buildTree(localPath));
  pushExploreFurther(lines);
  return lines.join("\n");
}

function treeCloneContent(localPath: string, info: GitHubUrlInfo, lines: string[]): string {
  const dirPath = info.path || "";
  const fullDirPath = resolveWithinRepo(localPath, dirPath);
  if (!fullDirPath || !existsSync(fullDirPath)) {
    return missingPathCloneContent(localPath, dirPath, lines);
  }
  lines.push(`## ${dirPath || "/"}`);
  lines.push(buildDirListing(localPath, dirPath));
  pushExploreFurther(lines);
  return lines.join("\n");
}

function statErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function blobFileBytes(filePath: string, fullFilePath: string, stat: Stats, lines: string[]): string {
  if (isBinaryFile(fullFilePath)) {
    const ext = extname(filePath).replace(".", "");
    lines.push(`## ${filePath}`);
    lines.push(
      `Binary file (${ext}, ${formatFileSize(stat.size)}). Use \`read\` or \`bash\` tools at the path above to inspect.`,
    );
    return lines.join("\n");
  }

  let content: string;
  try {
    content = readFileSync(fullFilePath, "utf-8");
  } catch {
    lines.push(`Could not read \`${filePath}\` as UTF-8 text.`);
    pushExploreFurther(lines);
    return lines.join("\n");
  }

  lines.push(`## ${filePath}`);
  if (content.length > MAX_INLINE_FILE_CHARS) {
    lines.push(content.slice(0, MAX_INLINE_FILE_CHARS));
    lines.push(`\n[File truncated at 100K chars. Full file: ${fullFilePath}]`);
  } else {
    lines.push(content);
  }
  pushExploreFurther(lines);
  return lines.join("\n");
}

function blobFileContent(localPath: string, filePath: string, fullFilePath: string, lines: string[]): string {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(fullFilePath);
  } catch (err) {
    lines.push(`Could not inspect \`${filePath}\`: ${statErrorMessage(err)}`);
    pushExploreFurther(lines);
    return lines.join("\n");
  }

  if (stat.isDirectory()) {
    lines.push(`## ${filePath || "/"}`);
    lines.push(buildDirListing(localPath, filePath));
    pushExploreFurther(lines);
    return lines.join("\n");
  }

  return blobFileBytes(filePath, fullFilePath, stat, lines);
}

function blobCloneContent(localPath: string, info: GitHubUrlInfo, lines: string[]): string {
  const filePath = info.path || "";
  const fullFilePath = resolveWithinRepo(localPath, filePath);
  if (!fullFilePath || !existsSync(fullFilePath)) {
    return missingPathCloneContent(localPath, filePath, lines);
  }
  return blobFileContent(localPath, filePath, fullFilePath, lines);
}

function generateCloneContent(localPath: string, info: GitHubUrlInfo): string {
  const lines: string[] = [];
  lines.push(`Repository cloned to: ${localPath}`);
  lines.push("");

  if (info.type === "root") {
    return rootCloneContent(localPath, lines);
  }

  if (info.type === "tree") {
    return treeCloneContent(localPath, info, lines);
  }

  // blob
  return blobCloneContent(localPath, info, lines);
}
