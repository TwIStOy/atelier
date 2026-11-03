import { readFileSync } from "node:fs";
import { stat as fsStat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveSearchPath, runRg, truncateOutput } from "../shared.ts";

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

type MatchRow = { absPath: string; line: number; text: string };

function parseMatchEvent(execCwd: string, line: string): MatchRow | undefined {
  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(line) as typeof event;
  } catch {
    return undefined;
  }
  if (event.type !== "match") return undefined;
  const d = event.data;
  const pathObj = d?.path as { text?: string } | undefined;
  const lineNum = d?.line_number;
  const linesObj = d?.lines as { text?: string } | undefined;
  const pathText = pathObj?.text;
  if (!pathText || typeof lineNum !== "number") return undefined;
  const absPath = path.isAbsolute(pathText) ? path.normalize(pathText) : path.resolve(execCwd, pathText);
  const text =
    typeof linesObj?.text === "string"
      ? linesObj.text.replace(/\r\n/g, "\n").replace(/\r/g, "").replace(/\n$/, "")
      : "";
  return { absPath, line: lineNum, text };
}

export function registerGrepTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "grep",
    label: "Grep",
    description: grepToolDescription,
    promptSnippet: "Search file contents with regex (ripgrep); optional include glob; results sorted by file mtime",
    parameters: grepParams,
    annotations: { readOnlyHint: true },
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

      const rows = await runRg(args, ctx.cwd, signal, MATCH_LIMIT, (line) => parseMatchEvent(ctx.cwd, line));

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

      const output = truncateOutput(outLines.join("\n"));

      return {
        content: [{ type: "text", text: output.text }],
        details: {
          matches: total,
          truncated,
          bytesTruncated: output.truncated,
        },
      };
    },
  });
}
