/**
 * File-based diagnostic logger for the pi-herdr extension.
 *
 * Writes timestamped lines to $XDG_STATE_HOME/pi/herdr.log (default
 * ~/.local/state/pi/herdr.log). Never touches stdout/stderr — those corrupt
 * the pi TUI. All failures are swallowed so diagnostics can never break an
 * agent turn.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

function resolveLogPath(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_STATE_HOME?.trim();
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "state");
  return join(base, "pi", "herdr.log");
}

const LOG_PATH = resolveLogPath();

export function logDebug(msg: string): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    const ts = new Date().toISOString();
    appendFileSync(LOG_PATH, `${ts} ${msg}\n`, "utf8");
  } catch {
    // Diagnostics must never break the agent turn.
  }
}

export function getLogPath(): string {
  return LOG_PATH;
}
