import { mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findExecutable, openRexPane, type RexContext } from "@htwang-contrib/common";

export async function openCanvasPreview(
  exec: ExtensionAPI["exec"],
  rex: RexContext,
  options: { url: string; cwd: string; terminalBrowser: string },
): Promise<string> {
  const browser = findExecutable(options.terminalBrowser);
  if (!browser) {
    throw new Error("terminal-browser not found. Install it on this host or set Canvas > Terminal Browser in /config.");
  }
  const envExecutable = findExecutable("env");
  if (!envExecutable) throw new Error("The env executable is required to launch the Canvas preview.");

  const root = join(homedir(), ".pi", "agent", "canvas-browser");
  const directories = {
    TERMINAL_BROWSER_APPDATA: join(root, "profiles"),
    TERMINAL_BROWSER_CONFIG_DIR: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_RUNTIME_DIR: join(process.env.XDG_RUNTIME_DIR || tmpdir(), `pi-canvas-browser-${process.getuid?.() ?? 0}`),
  };
  for (const directory of Object.values(directories)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const environment = Object.entries({
    ...directories,
    PATH: process.env.PATH ?? "",
    TERMINAL_BROWSER_NO_TELEMETRY: "1",
    TERMINAL_BROWSER_PRESENT: "animation",
  }).map(([key, value]) => `${key}=${value}`);
  const configured = await exec(envExecutable, [...environment, browser, "config", "set", "render.fps", "30"], {
    cwd: options.cwd,
    timeout: 15_000,
  });
  if (configured.code !== 0 || configured.killed) {
    throw new Error(
      `Could not configure the Canvas browser: ${configured.stderr.trim() || configured.stdout.trim() || `exit ${configured.code}`}`,
    );
  }

  return openRexPane(exec, rex, {
    cwd: options.cwd,
    label: "Canvas",
    direction: "right",
    command: [envExecutable, ...environment, browser, "open", "--no-merge", options.url],
  });
}
