import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { join as pathJoin } from "node:path";
import { statSync } from "node:fs";

export interface SocketPathOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: string;
}

export function resolveSocketPath(options: SocketPathOptions = {}): string {
  const env = options.env ?? process.env;
  const override = env.MOSHI_SOCKET_PATH;
  if (override && override.length > 0) return override;
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    return pathJoin(
      options.homedir ?? homedir(),
      "Library",
      "Application Support",
      "Moshi",
      "moshi-hook.sock",
    );
  }
  const xdg = env.XDG_RUNTIME_DIR;
  if (xdg && xdg.length > 0) return pathJoin(xdg, "moshi-hook.sock");
  return "/tmp/moshi-hook.sock";
}

export interface SocketExistsOptions {
  statSync?: typeof statSync;
  env?: NodeJS.ProcessEnv;
}

export function socketFileExists(options: SocketExistsOptions = {}): boolean {
  const statSyncFn = options.statSync ?? statSync;
  try {
    const stat = statSyncFn(resolveSocketPath({ env: options.env }));
    return stat.isSocket();
  } catch {
    return false;
  }
}

export interface DaemonResponse {
  type?: string;
  decision?: string;
  error?: string;
}

export type SocketSendStatus =
  | { status: "sent"; response: DaemonResponse | null }
  | { status: "connect-failed"; error: string }
  | { status: "error"; error: string };

export interface SendEnvelopeOptions {
  socketPath?: string;
  wait?: boolean;
  waitTimeoutMs?: number;
  createConnection?: typeof createConnection;
  setTimeout?: typeof globalThis.setTimeout;
}

export function sendEnvelopeToSocket(
  envelope: Record<string, unknown>,
  options: SendEnvelopeOptions = {},
): Promise<SocketSendStatus> {
  return new Promise((resolve) => {
    const socketPath = options.socketPath ?? resolveSocketPath();
    const createConn = options.createConnection ?? createConnection;
    const setTimeoutFn = options.setTimeout ?? globalThis.setTimeout;
    let settled = false;
    const finish = (result: SocketSendStatus) => {
      if (settled) return;
      settled = true;
      try {
        sock?.destroy();
      } catch {
        // ignore
      }
      resolve(result);
    };

    let sock: Socket | null;
    try {
      sock = createConn({ path: socketPath });
    } catch (e) {
      finish({
        status: "connect-failed",
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    sock.setNoDelay(true);

    const wait = options.wait ?? false;
    const waitTimeoutMs = options.waitTimeoutMs;

    const markFailed = (err: unknown) => {
      const code =
        err && typeof err === "object"
          ? (err as { code?: unknown }).code
          : undefined;
      const msg = err instanceof Error ? err.message : String(err);
      const indicator = typeof code === "string" ? code : msg;
      if (
        indicator.includes("ENOENT") ||
        indicator.includes("ECONNREFUSED") ||
        indicator.includes("EACCES") ||
        indicator.includes("EPIPE") ||
        indicator.includes("connect ENOENT")
      ) {
        finish({ status: "connect-failed", error: msg });
      } else {
        finish({ status: "error", error: msg });
      }
    };

    sock.once("error", markFailed);

    if (wait && waitTimeoutMs && waitTimeoutMs > 0) {
      setTimeoutFn(
        () => finish({ status: "error", error: "timeout" }),
        waitTimeoutMs,
      ).unref?.();
    }

    sock.once("connect", () => {
      try {
        sock!.write(JSON.stringify(envelope) + "\n");
      } catch (e) {
        finish({
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
        return;
      }
      if (!wait) {
        sock!.end();
      }
    });

    const chunks: Buffer[] = [];
    sock.on("data", (b: Buffer) => chunks.push(b));
    const parse = () => {
      if (settled) return;
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        finish({ status: "sent", response: null });
        return;
      }
      try {
        const parsed = JSON.parse(text.split("\n")[0]) as DaemonResponse;
        finish({ status: "sent", response: parsed });
      } catch {
        finish({ status: "sent", response: null });
      }
    };
    sock.once("end", parse);
    sock.once("close", parse);
  });
}
