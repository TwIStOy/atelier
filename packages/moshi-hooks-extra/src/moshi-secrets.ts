import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveStateDir } from "@htwang-contrib/common";
import {
  MOSHI_BASE_URL,
  type MoshiCredentials,
  type ReadKeychainFn,
  readMoshiSecretsFromKeychain,
} from "./keychain.ts";

export {
  MOSHI_BASE_URL,
  MOSHI_KEYCHAIN_SERVICE,
  type MoshiCredentials,
  readMoshiSecretsFromKeychain,
} from "./keychain.ts";

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
  /** macOS Keychain service name. Defaults to Moshi's `app.getmoshi.hook`. */
  keychainService?: string;
  /** Override the keychain reader (mainly for tests). Default spawns `security`. */
  readKeychain?: ReadKeychainFn;
}

function fileSecretsPaths(opts: Required<Pick<MoshiSecretsOptions, "stateDir" | "homeDir" | "platform">>): string[] {
  const candidates: string[] = [];
  if (opts.platform === "darwin") {
    candidates.push(join(opts.homeDir, ".config", "moshi", "secrets.json"));
  }
  candidates.push(join(opts.stateDir, "moshi", "secrets.json"));
  return candidates;
}

export function readMoshiSecretsFromFile(options: MoshiSecretsOptions = {}): MoshiCredentials | null {
  const platform = options.platform ?? process.platform;
  const stateDir = options.stateDir ?? resolveStateDir();
  const homeDir = options.homeDir ?? homedir();
  const exists = options.existsSync ?? ((p) => existsSync(p));
  const readFile = options.readFileSync ?? ((p, enc) => readFileSync(p, enc as BufferEncoding));

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
      baseUrl: MOSHI_BASE_URL,
    };
  }
  return null;
}

/**
 * Resolve Moshi credentials for the current host.
 *
 * On macOS (darwin) the Moshi desktop app stores its credentials in the
 * Keychain, so that is tried first; the JSON file is a fallback (it is also
 * the `--store` path Moshi writes when explicitly configured that way). On
 * every other platform only the file source is consulted. Returns `null` when
 * no source yields a usable `host-id` + `host-secret` pair.
 */
export function readMoshiSecrets(options: MoshiSecretsOptions = {}): MoshiCredentials | null {
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    const fromKeychain = readMoshiSecretsFromKeychain({
      service: options.keychainService,
      read: options.readKeychain,
    });
    if (fromKeychain) return fromKeychain;
  }
  return readMoshiSecretsFromFile(options);
}
