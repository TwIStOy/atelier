import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { checkBashCommand } from "./bash-check.ts";

const PROTECTED_PREFIX = "/run/agenix";

const READ_LIKE_TOOLS = new Set(["read", "glob", "grep"]);

function isProtectedPath(p: string): boolean {
  const resolved = p.startsWith("/") ? p : `/${p}`;
  return resolved === PROTECTED_PREFIX || resolved.startsWith(PROTECTED_PREFIX + "/");
}

function checkPath(input: Record<string, unknown>): string | null {
  if (typeof input.filePath === "string" && isProtectedPath(input.filePath)) {
    return input.filePath;
  }
  if (typeof input.path === "string" && isProtectedPath(input.path)) {
    return input.path;
  }
  return null;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (READ_LIKE_TOOLS.has(event.toolName)) {
      const matched = checkPath(event.input as Record<string, unknown>);
      if (matched) {
        ctx.ui.notify(`Blocked: ${event.toolName} targeting protected path ${matched}`, "warning");
        return {
          block: true,
          reason: `Access denied: path "${matched}" is under protected directory "${PROTECTED_PREFIX}". Secrets managed by agenix must not be read.`,
        };
      }
    }

    if (event.toolName === "bash") {
      const command = (event.input as Record<string, unknown>).command;
      if (typeof command !== "string") return;
      const reason = checkBashCommand(command);
      if (reason) {
        ctx.ui.notify(`Blocked: bash command accesses protected path`, "warning");
        return {
          block: true,
          reason: `Access denied: ${reason}. Secrets managed by agenix must not be exposed to stdout.`,
        };
      }
    }

    return;
  });
}
