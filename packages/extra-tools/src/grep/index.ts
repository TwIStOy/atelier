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
type EnrichedMatch = MatchRow & { mtime: number };

function requirePattern(pattern: string | undefined): string {
  const trimmed = pattern?.trim();
  if (!trimmed) {
    throw new Error("pattern is required");
  }
  return trimmed;
}

async function assertSearchablePath(searchPath: string): Promise<void> {
  try {
    await fsStat(searchPath);
  } catch {
    throw new Error(`Path not found: ${searchPath}`);
  }
}

function buildGrepArgs(pattern: string, include: string | undefined, searchPath: string): string[] {
  const args = ["--json", "--line-number", "--color=never", "--hidden"];
  const includeGlob = include?.trim();
  if (includeGlob) {
    args.push("--glob", includeGlob);
  }
  args.push("--", pattern, searchPath);
  return args;
}

async function collectFileMtimes(files: string[]): Promise<Map<string, number>> {
  const mtimes = new Map<string, number>();
  await Promise.all(
    files.map(async (file) => {
      try {
        const s = await fsStat(file);
        if (!s.isFile()) return;
        mtimes.set(file, s.mtimeMs);
      } catch {
        return;
      }
    }),
  );
  return mtimes;
}

function enrichMatches(rows: MatchRow[], mtimes: Map<string, number>): EnrichedMatch[] {
  return rows.map((r) => ({ ...r, mtime: mtimes.get(r.absPath) ?? 0 })).filter((r) => mtimes.has(r.absPath));
}

function sortByMtime(enriched: EnrichedMatch[]): void {
  enriched.sort((a, b) => {
    const d = b.mtime - a.mtime;
    if (d !== 0) return d;
    const p = a.absPath.localeCompare(b.absPath);
    if (p !== 0) return p;
    return a.line - b.line;
  });
}

function capMatches(matches: EnrichedMatch[]): { final: EnrichedMatch[]; total: number; truncated: boolean } {
  const total = matches.length;
  const truncated = total > MATCH_LIMIT;
  return { total, truncated, final: truncated ? matches.slice(0, MATCH_LIMIT) : matches };
}

function formatMatchLine(match: EnrichedMatch): string {
  const lineText = match.text.length > MAX_LINE_LENGTH ? `${match.text.slice(0, MAX_LINE_LENGTH)}...` : match.text;
  return ` Line ${match.line}: ${lineText}`;
}

function appendMatchLines(outLines: string[], matches: EnrichedMatch[]): void {
  let currentPath = "";
  for (const match of matches) {
    if (currentPath !== match.absPath) {
      if (currentPath !== "") outLines.push("");
      currentPath = match.absPath;
      outLines.push(`${match.absPath}:`);
    }
    outLines.push(formatMatchLine(match));
  }
}

function resultLines(final: EnrichedMatch[], total: number, truncated: boolean): string[] {
  const outLines = [`Found ${total} matches${truncated ? ` (showing first ${MATCH_LIMIT})` : ""}`];
  appendMatchLines(outLines, final);
  if (truncated) {
    outLines.push("");
    outLines.push(
      `(Results truncated: showing ${MATCH_LIMIT} of ${total} matches (${total - MATCH_LIMIT} hidden). Consider a more specific path or pattern.)`,
    );
  }
  return outLines;
}

function parseRgEvent(line: string): { type?: string; data?: Record<string, unknown> } | undefined {
  try {
    return JSON.parse(line) as { type?: string; data?: Record<string, unknown> };
  } catch {
    return undefined;
  }
}

function hasMatchFields(d: Record<string, unknown> | undefined): d is Record<string, unknown> {
  if (!d) return false;
  const pathText = (d.path as { text?: string } | undefined)?.text;
  return Boolean(pathText) && typeof d.line_number === "number";
}

function resolveMatchPath(execCwd: string, pathText: string): string {
  return path.isAbsolute(pathText) ? path.normalize(pathText) : path.resolve(execCwd, pathText);
}

function matchText(lines: unknown): string {
  const linesObj = lines as { text?: string } | undefined;
  return typeof linesObj?.text === "string"
    ? linesObj.text.replace(/\r\n/g, "\n").replace(/\r/g, "").replace(/\n$/, "")
    : "";
}

function matchRow(execCwd: string, d: Record<string, unknown>): MatchRow {
  const pathText = (d.path as { text?: string } | undefined)?.text;
  return {
    absPath: resolveMatchPath(execCwd, pathText as string),
    line: d.line_number as number,
    text: matchText(d.lines),
  };
}

function parseMatchEvent(execCwd: string, line: string): MatchRow | undefined {
  const event = parseRgEvent(line);
  if (event?.type !== "match") return undefined;
  const d = event.data;
  if (!hasMatchFields(d)) return undefined;
  return matchRow(execCwd, d);
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
      const pattern = requirePattern(params.pattern);
      const searchPath = resolveSearchPath(params.path, ctx.cwd);
      await assertSearchablePath(searchPath);

      const args = buildGrepArgs(pattern, params.include, searchPath);

      const rows = await runRg(args, ctx.cwd, signal, MATCH_LIMIT, (line) => parseMatchEvent(ctx.cwd, line));

      if (rows.length === 0) {
        return {
          content: [{ type: "text", text: "No files found" }],
          details: { matches: 0, truncated: false },
        };
      }

      const uniqueFiles = [...new Set(rows.map((r) => r.absPath))];
      const mtimes = await collectFileMtimes(uniqueFiles);
      const enriched = enrichMatches(rows, mtimes);

      if (enriched.length === 0) {
        return {
          content: [{ type: "text", text: "No files found" }],
          details: { matches: 0, truncated: false },
        };
      }

      sortByMtime(enriched);
      const { final, total, truncated } = capMatches(enriched);
      const outLines = resultLines(final, total, truncated);

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
