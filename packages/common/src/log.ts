/**
 * File-based diagnostic logger for pi extensions.
 *
 * Writes timestamped lines to a single shared file at
 * `$XDG_STATE_HOME/pi/extensions.log` (default `~/.local/state/pi/extensions.log`).
 * Every extension writes to the same file, distinguished by a `[name]` tag, so a
 * single `tail -f` shows cross-extension activity.
 *
 * Never touches stdout/stderr — those corrupt the pi TUI. All IO failures are
 * swallowed so diagnostics can never break an agent turn.
 *
 * Line format: `ISO [name] LEVEL message`
 *
 * Append-only writes below `PIPE_BUF` (typically 4096 bytes on Linux) are
 * atomic on POSIX filesystems, so concurrent appenders from different
 * extensions do not interleave — no lock is required.
 */

import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface CreateLoggerOptions {
  /** Environment used to resolve the state dir. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Messages below this level are dropped. Defaults to `debug` (all enabled). */
  minLevel?: LogLevel;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LOG_FILE_SIZE_WARNING_GUARD = Symbol.for("htwang-contrib.log-file-size-warning.installed");
const LOG_FILE_SIZE_WARNING_BYTES = 500 * 1024 * 1024;

/**
 * Resolve the base state directory.
 *
 * Honors `XDG_STATE_HOME`, then `$HOME/.local/state`, finally falling back to
 * `os.homedir()/.local/state`. Trims and validates so an empty `XDG_STATE_HOME`
 * falls through rather than producing a relative path.
 */
export function resolveStateDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const xdg = env.XDG_STATE_HOME?.trim();
  if (xdg && xdg.length > 0) return xdg;
  const envHome = env.HOME?.trim();
  if (envHome && envHome.length > 0) return join(envHome, ".local", "state");
  return join(home, ".local", "state");
}

/** Path to the shared extensions log file. */
export function getExtensionsLogPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveStateDir(env), "pi", "extensions.log");
}

export function registerLogFileSizeWarning(pi: Pick<ExtensionAPI, "on">, env: NodeJS.ProcessEnv = process.env): void {
  const guard = pi as unknown as Record<symbol, boolean>;
  if (guard[LOG_FILE_SIZE_WARNING_GUARD]) return;
  guard[LOG_FILE_SIZE_WARNING_GUARD] = true;

  let checked = false;
  pi.on("session_start", (event, ctx) => {
    if (checked || event.reason !== "startup") return;
    checked = true;

    const logPath = getExtensionsLogPath(env);
    try {
      if (statSync(logPath).size <= LOG_FILE_SIZE_WARNING_BYTES) return;
      ctx.ui.notify(`Extension log exceeds 500 MiB. Check ${logPath}.`, "warning");
    } catch {}
  });
}

function appendLine(logPath: string, line: string): void {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, line, "utf8");
  } catch {
    // Diagnostics must never break the agent turn.
  }
}

function writeLine(logPath: string, name: string, level: LogLevel, msg: string): void {
  const ts = new Date().toISOString();
  appendLine(logPath, `${ts} [${name}] ${level.toUpperCase()} ${msg}\n`);
}

/**
 * Create a namespaced logger that appends to the shared extensions log.
 *
 * Cheap to construct (a closure over the resolved path); calling
 * `createLogger("foo")` at module top-level in several files is fine.
 */
export function createLogger(name: string, opts: CreateLoggerOptions = {}): Logger {
  const logPath = getExtensionsLogPath(opts.env);
  const minPriority = LEVEL_PRIORITY[opts.minLevel ?? "debug"];
  const write = (level: LogLevel, msg: string): void => {
    if (LEVEL_PRIORITY[level] < minPriority) return;
    writeLine(logPath, name, level, msg);
  };
  return {
    debug: (msg) => write("debug", msg),
    info: (msg) => write("info", msg),
    warn: (msg) => write("warn", msg),
    error: (msg) => write("error", msg),
  };
}
