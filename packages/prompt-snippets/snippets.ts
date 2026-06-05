import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { collectSnippetDirs } from "./discover.ts";

export interface Snippet {
  name: string;
  filePath: string;
  description: string;
  argumentHint: string;
  body: string;
  source: string;
}

export function parseSnippet(filePath: string, source: string): Snippet {
  const content = readFileSync(filePath, "utf-8");
  const name = basename(filePath, ".md");
  const { frontmatter, body } = parseFrontmatter(content);

  return {
    name,
    filePath,
    description:
      typeof frontmatter.description === "string"
        ? frontmatter.description
        : "",
    argumentHint:
      typeof frontmatter["argument-hint"] === "string"
        ? frontmatter["argument-hint"]
        : "",
    body,
    source,
  };
}

export function expandPositional(body: string, args: string[]): string {
  let result = body;

  result = result.replace(/\$\{@:(\d+):(\d+)\}/g, (_, start, len) => {
    const s = parseInt(start) - 1;
    const l = parseInt(len);
    return args.slice(s, s + l).join(" ");
  });

  result = result.replace(/\$\{@:(\d+)\}/g, (_, start) => {
    return args.slice(parseInt(start) - 1).join(" ");
  });

  const allArgs = args.join(" ");
  result = result.replace(/\$@/g, allArgs);
  result = result.replace(/\$ARGUMENTS/g, allArgs);

  result = result.replace(/\$(\d+)/g, (_, idx) => {
    const i = parseInt(idx) - 1;
    return i >= 0 && i < args.length ? args[i] : "";
  });

  return result;
}

export function expandSnippet(snippet: Snippet, rawArgs: string): string {
  const trimmed = rawArgs.trim();
  const args = trimmed === "" ? [] : trimmed.split(/\s+/);
  return expandPositional(snippet.body, args);
}

export function discoverSnippets(cwd: string, agentDir: string): Snippet[] {
  const snippetDirs = collectSnippetDirs(cwd, agentDir);
  const map = new Map<string, Snippet>();

  for (const { dir, source } of snippetDirs) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    const entries = readdirSync(dir).filter((e) => e.endsWith(".md"));
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      if (!statSync(fullPath).isFile()) continue;
      const snippet = parseSnippet(fullPath, source);
      map.set(snippet.name, snippet);
    }
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function listSnippets(
  snippets: Snippet[],
  ctx: ExtensionCommandContext,
): void {
  if (snippets.length === 0) {
    ctx.ui.notify(
      "No snippets found. Create `.pi/snippets/*.md` or `~/.pi/agent/snippets/*.md`.",
      "info",
    );
    return;
  }

  const maxNameLen = Math.max(...snippets.map((s) => s.name.length));
  const lines = snippets.map((s) => {
    const padded = s.name.padEnd(maxNameLen);
    const desc = s.description ? `  ${s.description}` : "";
    const hint = s.argumentHint ? `  ${s.argumentHint}` : "";
    const src = `  [${s.source}]`;
    return `  ${padded}${desc}${hint}${src}`;
  });

  const output = [
    "Available snippets:",
    "",
    ...lines,
    "",
    `${snippets.length} snippet${snippets.length === 1 ? "" : "s"} found.`,
  ].join("\n");

  ctx.ui.notify(output, "info");
}

export function registerSnippetCommand(pi: ExtensionAPI): void {
  pi.registerCommand("snippet", {
    description: "List, expand, and send prompt snippets via sendUserMessage",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const agentDir = join(homedir(), ".pi", "agent");
      const snippets = discoverSnippets(ctx.cwd, agentDir);

      const trimmed = args.trim();
      if (trimmed === "" || trimmed === "list") {
        listSnippets(snippets, ctx);
        return;
      }

      const firstSpace = trimmed.indexOf(" ");
      const name = firstSpace < 0 ? trimmed : trimmed.slice(0, firstSpace);
      const rest = firstSpace < 0 ? "" : trimmed.slice(firstSpace + 1);

      const snippet = snippets.find((s) => s.name === name);
      if (!snippet) {
        ctx.ui.notify(
          `Snippet "${name}" not found. Use /snippet list to see available snippets.`,
          "error",
        );
        return;
      }

      if (!ctx.isIdle()) {
        ctx.ui.notify(
          "Agent is busy. Wait for the current turn to finish, then try again.",
          "warning",
        );
        return;
      }

      const expanded = expandSnippet(snippet, rest);
      pi.sendUserMessage(expanded);
    },
  });
}
