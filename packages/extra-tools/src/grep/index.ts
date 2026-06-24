import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { stat as fsStat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const grepDir = path.dirname(fileURLToPath(import.meta.url));
const grepToolDescription = readFileSync(path.join(grepDir, "grep.txt"), "utf-8").trim();

const MAX_LINE_LENGTH = 2000;
const MATCH_LIMIT = 100;

const grepParams = Type.Object({
  pattern: Type.String({
    description: "The regex pattern to search for in file contents (ripgrep regex syntax).",
  }),
  path: Type.Optional(
    Type.String({
      description: "Directory or file to search (relative to session cwd). Defaults to the current working directory.",
    }),
  ),
  include: Type.Optional(
    Type.String({
      description: 'Glob filter for paths to search (e.g. "*.ts", "*.{ts,tsx}").',
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

type MatchRow = { absPath: string; line: number; text: string };

function runRipgrep(
  args: string[],
  execCwd: string,
  signal: AbortSignal | undefined,
  maxMatches: number,
): Promise<MatchRow[]> {
  return new Promise((resolve, reject) => {
    const matches: MatchRow[] = [];
    const child = spawn("rg", args, {
      cwd: execCwd,
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
      if (!line.trim() || matches.length >= maxMatches) return;
      let event: { type?: string; data?: Record<string, unknown> };
      try {
        event = JSON.parse(line) as typeof event;
      } catch {
        return;
      }
      if (event.type !== "match") return;
      const d = event.data;
      const pathObj = d?.path as { text?: string } | undefined;
      const lineNum = d?.line_number;
      const linesObj = d?.lines as { text?: string } | undefined;
      const pathText = pathObj?.text;
      if (!pathText || typeof lineNum !== "number") return;
      const absPath = path.isAbsolute(pathText) ? path.normalize(pathText) : path.resolve(execCwd, pathText);
      const text =
        typeof linesObj?.text === "string"
          ? linesObj.text.replace(/\r\n/g, "\n").replace(/\r/g, "").replace(/\n$/, "")
          : "";
      matches.push({ absPath, line: lineNum, text });
      if (matches.length >= maxMatches && !child.killed) {
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
      const killedForCap = matches.length >= maxMatches;
      const c = code ?? 0;
      if (!killedForCap && c !== 0 && c !== 1) {
        const msg = stderr.trim() || `ripgrep exited with code ${c}`;
        settle(() => reject(new Error(msg)));
        return;
      }
      settle(() => resolve(matches));
    });
  });
}

export function registerGrepTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "grep",
    label: "Grep",
    description: grepToolDescription,
    promptSnippet: "Search file contents with regex (ripgrep); optional include glob; results sorted by file mtime",
    parameters: grepParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const pattern = params.pattern?.trim();
      if (!pattern) {
        throw new Error("pattern is required");
      }

      const searchPath = resolveSearchPath(params.path, ctx.cwd);
      try {
        await fsStat(searchPath);
      } catch {
        throw new Error(`Path not found: ${searchPath}`);
      }

      const args = ["--json", "--line-number", "--color=never", "--hidden"];
      if (params.include?.trim()) {
        args.push("--glob", params.include.trim());
      }
      args.push("--", pattern, searchPath);

      const rows = await runRipgrep(args, ctx.cwd, signal, MATCH_LIMIT);

      if (rows.length === 0) {
        return {
          content: [{ type: "text", text: "No files found" }],
          details: { matches: 0, truncated: false },
        };
      }

      const uniqueFiles = [...new Set(rows.map((r) => r.absPath))];
      const mtimes = new Map<string, number>();
      await Promise.all(
        uniqueFiles.map(async (file) => {
          try {
            const s = await fsStat(file);
            if (!s.isFile()) return;
            mtimes.set(file, s.mtimeMs);
          } catch {
            return;
          }
        }),
      );

      const enriched = rows
        .map((r) => ({ ...r, mtime: mtimes.get(r.absPath) ?? 0 }))
        .filter((r) => mtimes.has(r.absPath));

      if (enriched.length === 0) {
        return {
          content: [{ type: "text", text: "No files found" }],
          details: { matches: 0, truncated: false },
        };
      }

      enriched.sort((a, b) => {
        const d = b.mtime - a.mtime;
        if (d !== 0) return d;
        const p = a.absPath.localeCompare(b.absPath);
        if (p !== 0) return p;
        return a.line - b.line;
      });

      const total = enriched.length;
      const truncated = total > MATCH_LIMIT;
      const final = truncated ? enriched.slice(0, MATCH_LIMIT) : enriched;

      const outLines = [`Found ${total} matches${truncated ? ` (showing first ${MATCH_LIMIT})` : ""}`];

      let currentPath = "";
      for (const match of final) {
        if (currentPath !== match.absPath) {
          if (currentPath !== "") outLines.push("");
          currentPath = match.absPath;
          outLines.push(`${match.absPath}:`);
        }
        const lineText =
          match.text.length > MAX_LINE_LENGTH ? `${match.text.slice(0, MAX_LINE_LENGTH)}...` : match.text;
        outLines.push(` Line ${match.line}: ${lineText}`);
      }

      if (truncated) {
        outLines.push("");
        outLines.push(
          `(Results truncated: showing ${MATCH_LIMIT} of ${total} matches (${total - MATCH_LIMIT} hidden). Consider a more specific path or pattern.)`,
        );
      }

      let textOut = outLines.join("\n");
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
          matches: total,
          truncated,
          bytesTruncated: truncation.truncated,
        },
      };
    },
  });
}
