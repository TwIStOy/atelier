import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { stat as fsStat, type Stats } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const globDir = path.dirname(fileURLToPath(import.meta.url));
const globToolDescription = readFileSync(path.join(globDir, "glob.txt"), "utf-8").trim();

const FILE_LIMIT = 100;

const globParams = Type.Object({
  pattern: Type.String({
    description: "The glob pattern to match files against",
  }),
  path: Type.Optional(
    Type.String({
      description:
        'Directory to search (relative to session cwd). Omit to use the current working directory. Do not pass the string "undefined".',
    }),
  ),
});

function expandUser(p: string): string {
  if (p === "~" || p.startsWith("~/")) {
    return path.join(homedir(), p === "~" ? "" : p.slice(2));
  }
  return p;
}

function resolveSearchPath(raw: string | undefined, cwd: string): string {
  const p = (raw?.trim() || ".").trim() || ".";
  const expanded = expandUser(p);
  if (path.isAbsolute(expanded)) return path.normalize(expanded);
  return path.resolve(cwd, expanded);
}

function runRgFiles(
  cwd: string,
  globPattern: string,
  signal: AbortSignal | undefined,
  maxCollect: number,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const paths: string[] = [];
    const child = spawn("rg", ["--files", "--hidden", "--glob", globPattern, "."], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    const onAbort = () => {
      if (!child.killed) child.kill("SIGTERM");
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stderr?.on("data", (c) => {
      stderr += c.toString();
    });

    const stdout = child.stdout;
    if (!stdout) {
      settle(() => reject(new Error("ripgrep: no stdout")));
      return;
    }

    const rl = createInterface({ input: stdout });
    rl.on("line", (line) => {
      const rel = line.trim();
      if (!rel) return;
      paths.push(path.resolve(cwd, rel));
      if (paths.length >= maxCollect && !child.killed) {
        child.kill("SIGTERM");
      }
    });

    child.on("error", (err) => {
      rl.close();
      if (signal) signal.removeEventListener("abort", onAbort);
      settle(() =>
        reject(
          new Error(
            `ripgrep (rg) not found or failed to start: ${err.message}. Install ripgrep and ensure it is on PATH.`,
          ),
        ),
      );
    });

    child.on("close", (code) => {
      rl.close();
      if (signal) signal.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        settle(() => reject(new Error("Operation aborted")));
        return;
      }
      const killedForCap = paths.length >= maxCollect;
      const c = code ?? 0;
      if (!killedForCap && c !== 0 && c !== 1) {
        const msg = stderr.trim() || `ripgrep exited with code ${c}`;
        settle(() => reject(new Error(msg)));
        return;
      }
      settle(() => resolve(paths));
    });
  });
}

export function registerGlobTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "glob",
    label: "Glob",
    description: globToolDescription,
    promptSnippet: "List files by glob pattern (ripgrep); paths sorted by mtime; optional root directory",
    parameters: globParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const pattern = params.pattern?.trim();
      if (!pattern) {
        throw new Error("pattern is required");
      }

      const searchPath = resolveSearchPath(params.path, ctx.cwd);
      let st: Stats;
      try {
        st = await fsStat(searchPath);
      } catch {
        throw new Error(`Path not found: ${searchPath}`);
      }
      if (!st.isDirectory()) {
        throw new Error(`glob path must be a directory: ${searchPath}`);
      }

      const relPaths = await runRgFiles(searchPath, pattern, signal, FILE_LIMIT + 1);

      const truncated = relPaths.length > FILE_LIMIT;
      const capped = truncated ? relPaths.slice(0, FILE_LIMIT) : relPaths;

      const withMtime = await Promise.all(
        capped.map(async (p) => {
          try {
            const s = await fsStat(p);
            return { path: p, mtime: s.mtimeMs };
          } catch {
            return { path: p, mtime: 0 };
          }
        }),
      );

      withMtime.sort((a, b) => b.mtime - a.mtime);

      const paths = withMtime.map((x) => x.path);
      const count = paths.length;

      const lines: string[] = [];
      if (count === 0) {
        lines.push("No files found");
      } else {
        lines.push(...paths);
        if (truncated) {
          lines.push("");
          lines.push(
            `(Results are truncated: showing first ${FILE_LIMIT} results. Consider using a more specific path or pattern.)`,
          );
        }
      }

      let textOut = lines.join("\n");
      const truncation = truncateHead(textOut, {
        maxLines: Number.MAX_SAFE_INTEGER,
        maxBytes: DEFAULT_MAX_BYTES,
      });
      textOut = truncation.content;
      if (truncation.truncated) {
        textOut += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
      }

      return {
        content: [{ type: "text", text: textOut }],
        details: {
          count,
          truncated,
          bytesTruncated: truncation.truncated,
        },
      };
    },
  });
}
