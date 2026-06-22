import { spawn, spawnSync } from "node:child_process";
import { buildMoshiPayload, type MoshiPayload } from "./payload.ts";

export const DEFAULT_HOOK_BINARY = "moshi-hook";
export const PI_HOOK_SUBCOMMAND = "pi-hook";
export const VERSION_PROBE_SUBCOMMAND = "version";

export interface ResolveOptions {
  env?: NodeJS.ProcessEnv;
}

export function resolveMoshiHookBinary(options: ResolveOptions = {}): string {
  const env = options.env ?? process.env;
  const override = env.MOSHI_HOOK_BINARY;
  if (override && override.length > 0) return override;
  return DEFAULT_HOOK_BINARY;
}

export interface AvailabilityOptions {
  env?: NodeJS.ProcessEnv;
  binary?: string;
  spawnSync?: typeof import("node:child_process").spawnSync;
}

export function isMoshiHookAvailable(
  options: AvailabilityOptions = {},
): boolean {
  const binary = options.binary ?? resolveMoshiHookBinary({ env: options.env });
  const spawnSyncFn = options.spawnSync ?? spawnSync;
  try {
    const result = spawnSyncFn(binary, [VERSION_PROBE_SUBCOMMAND], {
      stdio: "ignore",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export interface SendOptions {
  binary?: string;
  env?: NodeJS.ProcessEnv;
  spawn?: typeof import("node:child_process").spawn;
}

export function sendToMoshi(
  hookEventName: string,
  event: unknown,
  ctx: unknown,
  extra: Record<string, unknown> = {},
  options: SendOptions = {},
): void {
  const payload = buildMoshiPayload(hookEventName, event, ctx, extra);
  dispatchPayload(payload, options);
}

export function sendPayload(
  payload: MoshiPayload,
  options: SendOptions = {},
): void {
  dispatchPayload(payload, options);
}

function dispatchPayload(payload: MoshiPayload, options: SendOptions): void {
  const binary = options.binary ?? resolveMoshiHookBinary({ env: options.env });
  const spawnFn = options.spawn ?? spawn;

  try {
    const child = spawnFn(binary, [PI_HOOK_SUBCOMMAND], {
      stdio: ["pipe", "ignore", "ignore"],
      detached: true,
    });
    child.stdin.end(JSON.stringify(payload));
    child.unref();
  } catch {
    // Hooks should never interrupt the user's Pi turn when Moshi is absent.
  }
}

export { buildMoshiPayload, type MoshiPayload };
