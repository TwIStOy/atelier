import { spawn, spawnSync } from "node:child_process";
import {
  buildSessionUpdateEnvelope,
  type EnvelopeParts,
  emptyExpiresAt,
  type MoshiHookCtx,
  type MoshiHookEvent,
  modelNameFromCtx,
  nowIso,
  projectNameForCwd,
  sessionIdFromEventCtx,
} from "./envelope.ts";
import { buildMoshiPayload, type MoshiPayload } from "./payload.ts";
import {
  type SocketSendStatus,
  sendEnvelopeToSocket,
  socketFileExists,
} from "./socket.ts";
import {
  EMPTY_TERMINAL_CONTEXT,
  getCachedTerminalContext,
  type TerminalContext,
} from "./terminal-context.ts";

export const DEFAULT_HOOK_BINARY = "moshi-hook";
export const PI_HOOK_SUBCOMMAND = "pi-hook";
export const VERSION_PROBE_SUBCOMMAND = "version";
export const NEVER_EXPIRES = emptyExpiresAt();

export type TransportMode = "socket" | "spawn" | "none";

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

export interface ResolveTransportOptions {
  env?: NodeJS.ProcessEnv;
  statSync?: typeof import("node:fs").statSync;
  spawnSync?: typeof import("node:child_process").spawnSync;
}

export function resolveTransportMode(
  options: ResolveTransportOptions = {},
): TransportMode {
  const env = options.env ?? process.env;
  if (socketFileExists({ statSync: options.statSync, env })) return "socket";
  if (isMoshiHookAvailable({ env, spawnSync: options.spawnSync }))
    return "spawn";
  return "none";
}

export type DispatchOutcome =
  | { transport: "socket"; status: SocketSendStatus }
  | { transport: "spawn" }
  | { transport: "none" };

export interface DispatchResult {
  outcome: DispatchOutcome;
  fallbackFromSocket?: boolean;
}

export interface DispatchOptions {
  binary?: string;
  env?: NodeJS.ProcessEnv;
  spawn?: typeof import("node:child_process").spawn;
  spawnSync?: typeof import("node:child_process").spawnSync;
  createConnection?: typeof import("node:net").createConnection;
  setTimeout?: typeof globalThis.setTimeout;
  statSync?: typeof import("node:fs").statSync;
  terminalContext?: TerminalContext;
  preferSocket?: boolean;
  wait?: boolean;
  waitTimeoutMs?: number;
}

export interface BuildEnvelopeArgs {
  eventName: string;
  event: unknown;
  ctx: unknown;
  terminalContext?: TerminalContext;
  extra?: Record<string, unknown>;
}

function firstNonEmpty(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

export interface CtxSnapshot {
  cwd: unknown;
  model: unknown;
  sessionManager: unknown;
}

function readCtxField<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

export function snapshotCtx(ctx: unknown): CtxSnapshot {
  if (!ctx || typeof ctx !== "object") {
    return { cwd: undefined, model: undefined, sessionManager: undefined };
  }
  const obj = ctx as {
    cwd?: unknown;
    model?: unknown;
    sessionManager?: unknown;
  };
  return {
    cwd: readCtxField(() => obj.cwd),
    model: readCtxField(() => obj.model),
    sessionManager: readCtxField(() => obj.sessionManager),
  };
}

export function buildEnvelope(
  args: BuildEnvelopeArgs,
  options: Pick<DispatchOptions, "env"> = {},
): Record<string, unknown> {
  const eventObj =
    args.event && typeof args.event === "object"
      ? (args.event as MoshiHookEvent)
      : {};
  const ctxObj =
    args.ctx && typeof args.ctx === "object" ? (args.ctx as MoshiHookCtx) : {};
  const env = options.env ?? process.env;
  const terminalContext =
    args.terminalContext ?? getCachedTerminalContext({ env });
  const sessionId = sessionIdFromEventCtx(eventObj, ctxObj);
  const cwd = firstNonEmpty(ctxObj.cwd as string, process.cwd());
  const modelName = modelNameFromCtx(ctxObj);
  const parts: EnvelopeParts = {
    source: "pi",
    sessionId,
    eventName: args.eventName,
    cwd,
    modelName,
    projectName: projectNameForCwd(cwd, terminalContext),
    requestedAt: nowIso(),
    expiresAt: NEVER_EXPIRES,
  };
  return buildSessionUpdateEnvelope(parts, terminalContext, args.extra ?? {});
}

export async function sendEnvelope(
  args: BuildEnvelopeArgs,
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  const preferSocket = options.preferSocket ?? true;
  const env = options.env ?? process.env;

  const snapshotArgs: BuildEnvelopeArgs = {
    ...args,
    ctx: snapshotCtx(args.ctx),
  };

  if (preferSocket && socketFileExists({ statSync: options.statSync, env })) {
    const envelope = buildEnvelope(snapshotArgs, { env });
    const status = await sendEnvelopeToSocket(envelope, {
      wait: options.wait,
      waitTimeoutMs: options.waitTimeoutMs,
      createConnection: options.createConnection,
      setTimeout: options.setTimeout,
    });
    if (status.status === "connect-failed") {
      const outcome = dispatchViaSpawn(snapshotArgs, options);
      return { outcome, fallbackFromSocket: true };
    }
    return { outcome: { transport: "socket", status } };
  }

  return { outcome: dispatchViaSpawn(snapshotArgs, options) };
}

function dispatchViaSpawn(
  args: BuildEnvelopeArgs,
  options: DispatchOptions,
): DispatchOutcome {
  if (
    !isMoshiHookAvailable({ env: options.env, spawnSync: options.spawnSync })
  ) {
    return { transport: "none" };
  }
  const binary = options.binary ?? resolveMoshiHookBinary({ env: options.env });
  const spawnFn = options.spawn ?? spawn;
  const payload = buildMoshiPayload(
    args.eventName,
    args.event,
    args.ctx,
    args.extra ?? {},
  );
  spawnPayload(binary, payload, spawnFn);
  return { transport: "spawn" };
}

function spawnPayload(
  binary: string,
  payload: MoshiPayload,
  spawnFn: NonNullable<DispatchOptions["spawn"]>,
): void {
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
  void sendEnvelope(
    { eventName: hookEventName, event, ctx, extra },
    {
      binary: options.binary,
      env: options.env,
      spawn: options.spawn,
    },
  );
}

export function sendPayload(
  payload: MoshiPayload,
  options: SendOptions = {},
): void {
  const binary = options.binary ?? resolveMoshiHookBinary({ env: options.env });
  const spawnFn = options.spawn ?? spawn;
  spawnPayload(binary, payload, spawnFn);
}

export type { TerminalContext };
export {
  buildMoshiPayload,
  EMPTY_TERMINAL_CONTEXT,
  getCachedTerminalContext,
  type MoshiPayload,
};
