import { execFileSync } from "node:child_process";

/** Moshi cloud usage API root. Not stored in the keychain — fixed by the API. */
export const MOSHI_BASE_URL = "https://api.getmoshi.app/api/v1";

/**
 * macOS Keychain entries written by the Moshi desktop app. Each value is a
 * generic password stored under a single service, distinguished by account
 * name. Discovered via `security dump-keychain` on a real Moshi install.
 */
export const MOSHI_KEYCHAIN_SERVICE = "app.getmoshi.hook";
export const MOSHI_KEYCHAIN_ACCOUNTS = {
  hostId: "host-id",
  hostSecret: "host-secret",
  hostDisplayName: "host-display-name",
} as const;

/** Read one generic-password value from the macOS Keychain. */
export type ReadKeychainFn = (
  service: string,
  account: string,
) => string | undefined;

export interface MoshiCredentials {
  hostId: string;
  hostSecret: string;
  hostName: string;
  baseUrl: string;
}

export interface ReadMoshiSecretsFromKeychainOptions {
  /** macOS Keychain service name. Defaults to Moshi's `app.getmoshi.hook`. */
  service?: string;
  /** Override the keychain reader (mainly for tests). Default spawns `security`. */
  read?: ReadKeychainFn;
}

/**
 * Default keychain reader — shells out to the macOS `security` tool.
 *
 * `security find-generic-password -s <service> -a <account> -w` prints the
 * stored password to stdout (with a trailing newline) and exits non-zero when
 * no matching item exists or the keychain is locked, which we swallow as
 * `undefined`. Only present on darwin; calling this on other platforms will
 * throw and be caught.
 */
function readKeychainDefault(
  service: string,
  account: string,
): string | undefined {
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return undefined;
  }
}

/**
 * Read Moshi credentials from the macOS Keychain.
 *
 * Returns `null` when the required `host-id` / `host-secret` entries are
 * absent (e.g. keychain locked, Moshi never paired on this host). The
 * optional `host-display-name` is best-effort.
 */
export function readMoshiSecretsFromKeychain(
  options: ReadMoshiSecretsFromKeychainOptions = {},
): MoshiCredentials | null {
  const service = options.service ?? MOSHI_KEYCHAIN_SERVICE;
  const read = options.read ?? readKeychainDefault;
  const hostId = read(service, MOSHI_KEYCHAIN_ACCOUNTS.hostId)?.trim();
  const hostSecret = read(service, MOSHI_KEYCHAIN_ACCOUNTS.hostSecret)?.trim();
  if (!hostId || !hostSecret) return null;
  const hostName =
    read(service, MOSHI_KEYCHAIN_ACCOUNTS.hostDisplayName)?.trim() ?? "";
  return {
    hostId,
    hostSecret,
    hostName,
    baseUrl: MOSHI_BASE_URL,
  };
}
