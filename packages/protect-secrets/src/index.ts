import type { ExtensionAPI, ExtensionUIContext, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { registerChildExtensionFactory } from "@htwang-contrib/common/agents/child-extensions";
import { isExtensionDisabled } from "@htwang-contrib/common/extension-disable";
import { checkBashCommand, DEFAULT_PROTECTED_PATHS } from "./bash-check.ts";
import { loadProjectConfig } from "./config.ts";

const READ_LIKE_TOOLS = new Set(["read", "glob", "grep"]);

function matchesPrefix(resolved: string, prefix: string): boolean {
  return resolved === prefix || resolved.startsWith(`${prefix}/`);
}

function matchProtectedPath(p: string, protectedPaths: readonly string[]): string | null {
  const resolved = p.startsWith("/") ? p : `/${p}`;
  for (const prefix of protectedPaths) {
    if (matchesPrefix(resolved, prefix)) return prefix;
  }
  return null;
}

function checkPath(
  input: Record<string, unknown>,
  protectedPaths: readonly string[],
): { path: string; matched: string } | null {
  for (const key of ["filePath", "path"]) {
    const value = input[key];
    if (typeof value === "string") {
      const matched = matchProtectedPath(value, protectedPaths);
      if (matched) return { path: value, matched };
    }
  }
  return null;
}

function readLikeToolBlock(
  toolName: string,
  input: Record<string, unknown>,
  protectedPaths: readonly string[],
  ui: ExtensionUIContext,
): ToolCallEventResult | null {
  if (!READ_LIKE_TOOLS.has(toolName)) return null;
  const hit = checkPath(input, protectedPaths);
  if (!hit) return null;
  ui.notify(`Blocked: ${toolName} targeting protected path ${hit.matched}`, "warning");
  return {
    block: true,
    reason: `Access denied: "${hit.path}" is under "${hit.matched}", which is a protected secrets location. Its contents are secrets and must not be read.`,
  };
}

function bashToolBlock(
  toolName: string,
  input: Record<string, unknown>,
  protectedPaths: readonly string[],
  ui: ExtensionUIContext,
): ToolCallEventResult | null {
  if (toolName !== "bash") return null;
  const command = input.command;
  if (typeof command !== "string") return null;
  const reason = checkBashCommand(command, protectedPaths);
  if (!reason) return null;
  ui.notify(`Blocked: bash command accesses protected path`, "warning");
  return {
    block: true,
    reason: `Access denied: ${reason}. The command touches a protected secrets location; secrets must not be exposed to stdout.`,
  };
}

export default function protectSecrets(pi: ExtensionAPI) {
  if (isExtensionDisabled("protect-secrets")) return;
  registerChildExtensionFactory("protect-secrets", protectSecrets);

  pi.on("session_start", (_event, ctx) => {
    const { issues } = loadProjectConfig(ctx.cwd);
    for (const issue of issues) {
      ctx.ui.notify(issue, "warning");
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    const { paths } = loadProjectConfig(ctx.cwd);
    const protectedPaths = paths.length > 0 ? [...DEFAULT_PROTECTED_PATHS, ...paths] : DEFAULT_PROTECTED_PATHS;
    const input = event.input as Record<string, unknown>;
    const readBlock = readLikeToolBlock(event.toolName, input, protectedPaths, ctx.ui);
    if (readBlock) return readBlock;
    const bashBlock = bashToolBlock(event.toolName, input, protectedPaths, ctx.ui);
    if (bashBlock) return bashBlock;
    return;
  });
}
