import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled, registerChildExtensionFactory } from "@htwang-contrib/common";
import { checkBashCommand, DEFAULT_PROTECTED_PATHS } from "./bash-check.ts";
import { loadProjectConfig } from "./config.ts";

const READ_LIKE_TOOLS = new Set(["read", "glob", "grep"]);

function matchProtectedPath(p: string, protectedPaths: readonly string[]): string | null {
  const resolved = p.startsWith("/") ? p : `/${p}`;
  for (const prefix of protectedPaths) {
    if (resolved === prefix || resolved.startsWith(`${prefix}/`)) return prefix;
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

    if (READ_LIKE_TOOLS.has(event.toolName)) {
      const hit = checkPath(event.input as Record<string, unknown>, protectedPaths);
      if (hit) {
        ctx.ui.notify(`Blocked: ${event.toolName} targeting protected path ${hit.matched}`, "warning");
        return {
          block: true,
          reason: `Access denied: "${hit.path}" is under "${hit.matched}", which is a protected secrets location. Its contents are secrets and must not be read.`,
        };
      }
    }

    if (event.toolName === "bash") {
      const command = (event.input as Record<string, unknown>).command;
      if (typeof command !== "string") return;
      const reason = checkBashCommand(command, protectedPaths);
      if (reason) {
        ctx.ui.notify(`Blocked: bash command accesses protected path`, "warning");
        return {
          block: true,
          reason: `Access denied: ${reason}. The command touches a protected secrets location; secrets must not be exposed to stdout.`,
        };
      }
    }

    return;
  });
}
