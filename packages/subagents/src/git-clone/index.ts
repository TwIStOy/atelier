import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const gitCloneToolDescription = readFileSync(path.join(toolDir, "git-clone.txt"), "utf-8").trim();

const CACHE_ROOT = path.join(tmpdir(), "scout-cache");

const FORBIDDEN_SCHEMES = ["file://", "git+ssh://", "ssh://"];

const gitCloneParams = Type.Object({
  url: Type.String({
    description:
      "Remote repository URL to clone. HTTPS (https://github.com/owner/repo) or git protocol only. file:// and ssh:// URLs are rejected.",
  }),
  branch: Type.Optional(
    Type.String({
      description:
        "Optional branch, tag, or commit to checkout after cloning. Ignored when an existing cache is reused.",
    }),
  ),
  shallow: Type.Optional(
    Type.Boolean({
      description: "Clone with --depth 1 (shallow). Defaults to true. Set false for full history.",
    }),
  ),
  repo_name: Type.Optional(
    Type.String({
      description:
        "Optional override for the cache directory name under scout-cache. Defaults to <owner>-<repo> derived from the URL.",
    }),
  ),
});

export function isForbiddenUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return FORBIDDEN_SCHEMES.some((s) => lower.startsWith(s));
}

export function deriveCacheName(url: string, override?: string): string | null {
  if (override?.trim()) {
    const safe = override.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
    return safe || null;
  }
  const trimmed = url.trim().replace(/\.git$/, "");
  const match = trimmed.match(/[:/]([^/]+)\/([^/]+)$/);
  if (!match) return null;
  const owner = match[1].replace(/[^a-zA-Z0-9._-]/g, "-");
  const repo = match[2].replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!owner || !repo) return null;
  return `${owner}-${repo}`;
}

function runGit(
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Operation aborted"));
      return;
    }
    const child = spawn("git", args, {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const killProcessGroup = () => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // process already gone
        }
      }
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      killProcessGroup();
      reject(new Error("Operation aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (d: Buffer) => {
      stdoutChunks.push(Buffer.from(d));
    });
    child.stderr.on("data", (d: Buffer) => {
      stderrChunks.push(Buffer.from(d));
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve({
        code: code ?? 0,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}

function dirIsNonEmpty(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function registerGitCloneTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "git_clone",
    label: "Git Clone",
    description: gitCloneToolDescription,
    promptSnippet: "Clone a remote git repo into a managed cache for read-only inspection",
    parameters: gitCloneParams,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const url = (params.url ?? "").trim();
      if (!url) {
        throw new Error("url is required");
      }
      if (isForbiddenUrl(url)) {
        throw new Error(
          "Refusing to clone: file://, git+ssh://, and ssh:// URLs are not allowed. Use https:// or git://.",
        );
      }

      const cacheName = deriveCacheName(url, params.repo_name);
      if (!cacheName) {
        throw new Error(`Could not derive a cache directory name from URL: ${url}. Pass repo_name explicitly.`);
      }
      const cachePath = path.join(CACHE_ROOT, cacheName);

      if (dirIsNonEmpty(cachePath)) {
        const msg = `Cache already exists at ${cachePath}. Reusing it as-is (no re-clone, no pull).`;
        return {
          content: [{ type: "text", text: msg }],
          details: {
            cache_path: cachePath,
            reused: true,
            cloned: false,
            url,
          },
        };
      }

      const shallow = params.shallow !== false;
      const cloneArgs = ["clone", "--quiet"];
      if (shallow) cloneArgs.push("--depth", "1");
      if (params.branch?.trim()) {
        cloneArgs.push("--branch", params.branch.trim());
      }
      cloneArgs.push(url, cachePath);

      let result: { code: number; stdout: string; stderr: string };
      try {
        result = await runGit(cloneArgs, tmpdir(), signal);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`git clone failed: ${msg}`);
      }

      const combined = `${result.stdout}${result.stderr ? (result.stdout ? "\n" : "") + result.stderr : ""}`;
      const truncation = truncateHead(combined, {
        maxLines: Number.MAX_SAFE_INTEGER,
        maxBytes: DEFAULT_MAX_BYTES,
      });
      let output = truncation.content.trim();
      if (truncation.truncated) {
        output += `\n\n[Output truncated: ${formatSize(DEFAULT_MAX_BYTES)} limit reached.]`;
      }

      if (result.code !== 0) {
        return {
          content: [
            {
              type: "text",
              text: `git clone exited with code ${result.code}.\n${output}\n\nRepository may be private, the URL wrong, or the network unavailable (GIT_TERMINAL_PROMPT=0 disables interactive auth).`,
            },
          ],
          details: {
            cache_path: cachePath,
            reused: false,
            cloned: false,
            exit_code: result.code,
            url,
          },
        };
      }

      const finalMsg = `Cloned ${url} into ${cachePath} (shallow=${shallow}). Use grep/glob/read on cache_path to inspect the source.`;
      const text = output ? `${finalMsg}\n\n${output}` : finalMsg;

      return {
        content: [{ type: "text", text }],
        details: {
          cache_path: cachePath,
          reused: false,
          cloned: true,
          shallow,
          url,
        },
      };
    },
  });
}
