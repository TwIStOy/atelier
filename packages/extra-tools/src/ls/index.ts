import { constants as fsConstants, readFileSync } from "node:fs";
import { access, readdir as fsReaddir, stat as fsStat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveSearchPath } from "../shared.ts";

const lsDir = path.dirname(fileURLToPath(import.meta.url));
const lsToolDescription = readFileSync(path.join(lsDir, "ls.txt"), "utf-8").trim();

const DEFAULT_LIMIT = 500;

const lsParams = Type.Object({
  path: Type.Optional(
    Type.String({
      description: "Directory to list (default: current directory)",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: `Maximum number of entries to return (default: ${DEFAULT_LIMIT})`,
    }),
  ),
});

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Operation aborted");
  }
}

function resolveLimit(rawLimit: number | undefined): number {
  return Math.max(
    1,
    Math.min(typeof rawLimit === "number" && Number.isFinite(rawLimit) ? Math.floor(rawLimit) : DEFAULT_LIMIT, 50_000),
  );
}

async function assertDirectory(dirPath: string): Promise<void> {
  if (!(await pathExists(dirPath))) {
    throw new Error(`Path not found: ${dirPath}`);
  }
  const st = await fsStat(dirPath);
  if (!st.isDirectory()) {
    throw new Error(`Not a directory: ${dirPath}`);
  }
}

async function readDirEntries(dirPath: string): Promise<string[]> {
  try {
    return await fsReaddir(dirPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Cannot read directory: ${msg}`);
  }
}

async function entrySuffix(fullPath: string): Promise<string | undefined> {
  try {
    const entryStat = await fsStat(fullPath);
    if (entryStat.isDirectory()) return "/";
  } catch {
    return undefined;
  }
  return "";
}

async function collectEntries(
  dirPath: string,
  entries: string[],
  limit: number,
  signal: AbortSignal | undefined,
): Promise<{ results: string[]; limitReached: boolean }> {
  const results: string[] = [];
  let limitReached = false;
  for (const entry of entries) {
    throwIfAborted(signal);
    if (results.length >= limit) {
      limitReached = true;
      break;
    }
    const suffix = await entrySuffix(path.join(dirPath, entry));
    if (suffix === undefined) continue;
    results.push(entry + suffix);
  }
  return { results, limitReached };
}

function lsNotices(limitReached: boolean, bytesTruncated: boolean, limit: number): string[] {
  const notices: string[] = [];
  if (limitReached) {
    notices.push(`${limit} entries limit reached. Use limit=${limit * 2} for more`);
  }
  if (bytesTruncated) {
    notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
  }
  return notices;
}

function formatLsResults(
  results: string[],
  limitReached: boolean,
  limit: number,
): { text: string; bytesTruncated: boolean } {
  const truncation = truncateHead(results.join("\n"), {
    maxLines: Number.MAX_SAFE_INTEGER,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  const notices = lsNotices(limitReached, truncation.truncated, limit);
  let text = truncation.content;
  if (notices.length > 0) {
    text += `\n\n[${notices.join(". ")}]`;
  }
  return { text, bytesTruncated: truncation.truncated };
}

function lsResult(results: string[], limitReached: boolean, limit: number) {
  const formatted = formatLsResults(results, limitReached, limit);
  return {
    content: [{ type: "text" as const, text: formatted.text }],
    details: {
      entries: results.length,
      entryLimitReached: limitReached ? limit : undefined,
      bytesTruncated: formatted.bytesTruncated,
    },
  };
}

export function registerLsTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ls",
    label: "Ls",
    description: lsToolDescription,
    promptSnippet: "List directory contents",
    parameters: lsParams,
    annotations: { readOnlyHint: true },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      throwIfAborted(signal);

      const dirPath = resolveSearchPath(params.path, ctx.cwd);
      const effectiveLimit = resolveLimit(params.limit);
      await assertDirectory(dirPath);

      const entries = await readDirEntries(dirPath);
      entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

      const { results, limitReached } = await collectEntries(dirPath, entries, effectiveLimit, signal);
      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "(empty directory)" }],
          details: { entries: 0 },
        };
      }

      return lsResult(results, limitReached, effectiveLimit);
    },
  });
}
