import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { constants as fsConstants, readFileSync } from "node:fs";
import { access, readdir as fsReaddir, stat as fsStat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";

const lsDir = path.dirname(fileURLToPath(import.meta.url));
const lsToolDescription = readFileSync(
  path.join(lsDir, "ls.txt"),
  "utf-8",
).trim();

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

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function registerLsTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ls",
    label: "Ls",
    description: lsToolDescription,
    promptSnippet: "List directory contents",
    parameters: lsParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const dirPath = resolveSearchPath(params.path, ctx.cwd);
      const rawLimit = params.limit;
      const effectiveLimit = Math.max(
        1,
        Math.min(
          typeof rawLimit === "number" && Number.isFinite(rawLimit)
            ? Math.floor(rawLimit)
            : DEFAULT_LIMIT,
          50_000,
        ),
      );

      if (!(await pathExists(dirPath))) {
        throw new Error(`Path not found: ${dirPath}`);
      }

      const st = await fsStat(dirPath);
      if (!st.isDirectory()) {
        throw new Error(`Not a directory: ${dirPath}`);
      }

      let entries: string[];
      try {
        entries = await fsReaddir(dirPath);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Cannot read directory: ${msg}`);
      }

      entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

      const results: string[] = [];
      let entryLimitReached = false;
      for (const entry of entries) {
        if (signal?.aborted) {
          throw new Error("Operation aborted");
        }
        if (results.length >= effectiveLimit) {
          entryLimitReached = true;
          break;
        }
        const fullPath = path.join(dirPath, entry);
        let suffix = "";
        try {
          const entryStat = await fsStat(fullPath);
          if (entryStat.isDirectory()) suffix = "/";
        } catch {
          continue;
        }
        results.push(entry + suffix);
      }

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "(empty directory)" }],
          details: { entries: 0 },
        };
      }

      const rawOutput = results.join("\n");
      const truncation = truncateHead(rawOutput, {
        maxLines: Number.MAX_SAFE_INTEGER,
        maxBytes: DEFAULT_MAX_BYTES,
      });
      let output = truncation.content;
      const notices: string[] = [];
      if (entryLimitReached) {
        notices.push(
          `${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`,
        );
      }
      if (truncation.truncated) {
        notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
      }
      if (notices.length > 0) {
        output += `\n\n[${notices.join(". ")}]`;
      }

      return {
        content: [{ type: "text", text: output }],
        details: {
          entries: results.length,
          entryLimitReached: entryLimitReached ? effectiveLimit : undefined,
          bytesTruncated: truncation.truncated,
        },
      };
    },
  });
}
