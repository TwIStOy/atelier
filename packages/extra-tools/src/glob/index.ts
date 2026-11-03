import { readFileSync, type Stats } from "node:fs";
import { stat as fsStat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveSearchPath, runRg, truncateOutput } from "../shared.ts";

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

function requirePattern(pattern: string | undefined): string {
  const trimmed = pattern?.trim();
  if (!trimmed) {
    throw new Error("pattern is required");
  }
  return trimmed;
}

async function resolveGlobDir(rawPath: string | undefined, cwd: string): Promise<string> {
  const searchPath = resolveSearchPath(rawPath, cwd);
  let st: Stats;
  try {
    st = await fsStat(searchPath);
  } catch {
    throw new Error(`Path not found: ${searchPath}`);
  }
  if (!st.isDirectory()) {
    throw new Error(`glob path must be a directory: ${searchPath}`);
  }
  return searchPath;
}

async function listMatchingFiles(
  pattern: string,
  searchPath: string,
  signal: AbortSignal | undefined,
): Promise<string[]> {
  return runRg(["--files", "--hidden", "--glob", pattern, "."], searchPath, signal, FILE_LIMIT + 1, (line) =>
    path.resolve(searchPath, line.trim()),
  );
}

function capFilePaths(relPaths: string[]): { paths: string[]; truncated: boolean } {
  const truncated = relPaths.length > FILE_LIMIT;
  return {
    truncated,
    paths: truncated ? relPaths.slice(0, FILE_LIMIT) : relPaths,
  };
}

async function sortByMtimeDesc(paths: string[]): Promise<string[]> {
  const withMtime = await Promise.all(
    paths.map(async (p) => {
      try {
        const s = await fsStat(p);
        return { path: p, mtime: s.mtimeMs };
      } catch {
        return { path: p, mtime: 0 };
      }
    }),
  );
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime.map((x) => x.path);
}

function globOutputLines(paths: string[], truncated: boolean): string[] {
  if (paths.length === 0) {
    return ["No files found"];
  }
  const lines = [...paths];
  if (truncated) {
    lines.push("");
    lines.push(
      `(Results are truncated: showing first ${FILE_LIMIT} results. Consider using a more specific path or pattern.)`,
    );
  }
  return lines;
}

export function registerGlobTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "glob",
    label: "Glob",
    description: globToolDescription,
    promptSnippet: "List files by glob pattern (ripgrep); paths sorted by mtime; optional root directory",
    parameters: globParams,
    annotations: { readOnlyHint: true },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const pattern = requirePattern(params.pattern);
      const searchPath = await resolveGlobDir(params.path, ctx.cwd);
      const relPaths = await listMatchingFiles(pattern, searchPath, signal);
      const { paths: cappedPaths, truncated } = capFilePaths(relPaths);
      const paths = await sortByMtimeDesc(cappedPaths);
      const count = paths.length;
      const lines = globOutputLines(paths, truncated);
      const output = truncateOutput(lines.join("\n"));

      return {
        content: [{ type: "text", text: output.text }],
        details: {
          count,
          truncated,
          bytesTruncated: output.truncated,
        },
      };
    },
  });
}
