import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_SESSION_DIR } from "./paths.ts";

const promptDir = path.dirname(fileURLToPath(import.meta.url));

let cachedPrompt: string | undefined;

export function subagentsFeatureSystemPrompt(): string {
  if (cachedPrompt === undefined) {
    cachedPrompt = readFileSync(path.join(promptDir, "feature-system-prompt.txt"), "utf-8").trim();
  }
  return cachedPrompt;
}

export function shouldInjectSubagentsParentSystemPrompt(ctx: Pick<ExtensionContext, "sessionManager">): boolean {
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile) return true;
  const sessionDir = path.resolve(path.dirname(sessionFile));
  const root = path.resolve(SUBAGENT_SESSION_DIR);
  if (sessionDir === root) return false;
  if (sessionDir.startsWith(`${root}${path.sep}`)) return false;
  return true;
}
