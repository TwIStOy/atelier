import { execFileSync } from "node:child_process";
import { readFileSync, watch } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLogger } from "@htwang-contrib/common";
import { detectFishShell, resolveFishVarsPath } from "./shell.ts";
import { FishVarsWatcher } from "./watcher.ts";

function readUserShell(): string | undefined {
  const user = process.env.USER ?? process.env.LOGNAME;
  if (!user) return undefined;
  try {
    const line = execFileSync("getent", ["passwd", user], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const fields = line.split(":");
    return fields[6];
  } catch {
    return undefined;
  }
}

export default function (pi: ExtensionAPI) {
  const logger = createLogger("fish-env-sync");

  const isFish = detectFishShell({
    envShell: process.env.SHELL,
    passwdShell: readUserShell(),
  });
  if (!isFish) {
    return;
  }

  const path = resolveFishVarsPath(process.env);
  let watcher: FishVarsWatcher | null = null;

  pi.on("session_start", async () => {
    if (watcher !== null) return;
    watcher = new FishVarsWatcher({
      path,
      env: process.env,
      logger,
      deps: {
        readFile: (p) => readFileSync(p, "utf8"),
        watch: (p, listener) =>
          watch(p, (eventType) => {
            listener(eventType);
          }),
        now: () => Date.now(),
        setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
        clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
      },
    });
    watcher.start();
  });

  pi.on("session_shutdown", async () => {
    if (watcher !== null) {
      watcher.stop();
      watcher = null;
    }
  });
}
