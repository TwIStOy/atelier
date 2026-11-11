import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findExecutable } from "./executable.ts";

export interface RexContext {
  executable: string;
  endpoint: string;
  sessionId: string;
  blockId: string;
}

export interface RexPaneOptions {
  cwd: string;
  label: string;
  command: [string, ...string[]];
  direction: "right" | "left" | "above" | "below";
}

async function runRexJson(
  exec: ExtensionAPI["exec"],
  executable: string,
  args: string[],
): Promise<Record<string, unknown>> {
  const result = await exec(executable, ["--autostart=false", ...args], { timeout: 15_000 });
  if (result.code !== 0 || result.killed) {
    throw new Error(`Rex failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`);
  }
  const value: unknown = JSON.parse(result.stdout);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Rex returned an invalid response.");
  }
  return value as Record<string, unknown>;
}

export async function getLocalRexContext(
  exec: ExtensionAPI["exec"],
  env: NodeJS.ProcessEnv = process.env,
): Promise<RexContext> {
  const sessionId = env.REX_SESSION?.trim();
  const blockId = env.REX_BLOCK?.trim();
  if (!sessionId || !blockId) throw new Error("Run this command inside a Rex terminal.");

  const executable = findExecutable(env.REX_BIN_DIR ? join(env.REX_BIN_DIR, "rex") : "rex", env);
  if (!executable) throw new Error("Rex executable not found. Make rex available on PATH.");

  const serverArgs = env.REX_SERVER ? ["--server", env.REX_SERVER] : [];
  const identity = await runRexJson(exec, executable, [...serverArgs, "whoami", "--json"]);
  if (identity.session_id !== sessionId || identity.block_id !== blockId) {
    throw new Error("The current Rex session or pane is no longer available.");
  }
  if (typeof identity.endpoint !== "string" || !identity.endpoint.startsWith("unix:///")) {
    throw new Error("Connect to the Rex server on this host through its local Unix socket.");
  }
  return { executable, endpoint: identity.endpoint, sessionId, blockId };
}

export async function renameRexPane(exec: ExtensionAPI["exec"], context: RexContext, label: string): Promise<void> {
  if (Array.from(label).length > 128 || /\p{Cc}/u.test(label)) {
    throw new Error("Rex labels must contain at most 128 characters and no control characters.");
  }
  await runRexJson(exec, context.executable, [
    "--server",
    context.endpoint,
    "api",
    "call",
    "--session",
    context.sessionId,
    "session.set_block_label",
    JSON.stringify({ block_id: context.blockId, label }),
  ]);
}

export async function openRexPane(
  exec: ExtensionAPI["exec"],
  context: RexContext,
  options: RexPaneOptions,
): Promise<string> {
  const result = await runRexJson(exec, context.executable, [
    "--server",
    context.endpoint,
    "run",
    "--session",
    context.sessionId,
    "--block",
    context.blockId,
    "--split",
    options.direction,
    "--focus=false",
    "--shell=none",
    "--cwd",
    options.cwd,
    "--label",
    options.label,
    "--json",
    "--",
    ...options.command,
  ]);
  const blockIds = result.block_ids;
  if (!Array.isArray(blockIds) || blockIds.length !== 1 || typeof blockIds[0] !== "string" || !blockIds[0]) {
    throw new Error("Rex did not return the new pane ID. Inspect the session before retrying.");
  }
  return blockIds[0];
}
