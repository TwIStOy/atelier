import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface MoshiCredentials {
  hostId: string;
  hostSecret: string;
  hostName: string;
  baseUrl: string;
}

interface SecretsFile {
  "host-id"?: string;
  "host-secret"?: string;
  "host-display-name"?: string;
}

export interface MoshiSecretsOptions {
  stateDir?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
  existsSync?: (path: string) => boolean;
  readFileSync?: (path: string, encoding: string) => string;
}

function fileSecretsPaths(
  opts: Required<
    Pick<MoshiSecretsOptions, "stateDir" | "homeDir" | "platform">
  >,
): string[] {
  const candidates: string[] = [];
  if (opts.platform === "darwin") {
    candidates.push(join(opts.homeDir, ".config", "moshi", "secrets.json"));
  }
  candidates.push(join(opts.stateDir, "moshi", "secrets.json"));
  return candidates;
}

export function resolveStateDir(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  const xdg = env.XDG_STATE_HOME;
  if (xdg && xdg.length > 0) return xdg;
  if (env.HOME && env.HOME.length > 0) return join(env.HOME, ".local", "state");
  return join(home, ".local", "state");
}

export function readMoshiSecretsFromFile(
  options: MoshiSecretsOptions = {},
): MoshiCredentials | null {
  const platform = options.platform ?? process.platform;
  const stateDir = options.stateDir ?? resolveStateDir();
  const homeDir = options.homeDir ?? homedir();
  const exists = options.existsSync ?? ((p) => existsSync(p));
  const readFile =
    options.readFileSync ??
    ((p, enc) => readFileSync(p, enc as BufferEncoding));

  for (const candidate of fileSecretsPaths({ stateDir, homeDir, platform })) {
    if (!exists(candidate)) continue;
    let parsed: SecretsFile;
    try {
      parsed = JSON.parse(readFile(candidate, "utf8")) as SecretsFile;
    } catch {
      continue;
    }
    const hostId = parsed["host-id"];
    const hostSecret = parsed["host-secret"];
    if (!hostId || !hostSecret) continue;
    return {
      hostId,
      hostSecret,
      hostName: parsed["host-display-name"] ?? "",
      baseUrl: "https://api.getmoshi.app/api/v1",
    };
  }
  return null;
}
