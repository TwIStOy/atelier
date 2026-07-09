import { describe, expect, test } from "vitest";
import {
  MOSHI_BASE_URL,
  MOSHI_KEYCHAIN_ACCOUNTS,
  MOSHI_KEYCHAIN_SERVICE,
  readMoshiSecretsFromKeychain,
} from "../src/keychain.ts";

/** Builds an in-memory keychain keyed by `service|account`. Trailing newlines
 * mimic the real `security -w` output so trim handling is exercised. */
function makeKeychain(entries: Record<string, string>) {
  return (service: string, account: string): string | undefined => {
    const v = entries[`${service}|${account}`];
    return v === undefined ? undefined : `${v}\n`;
  };
}

describe("readMoshiSecretsFromKeychain", () => {
  const FULL = makeKeychain({
    [`${MOSHI_KEYCHAIN_SERVICE}|${MOSHI_KEYCHAIN_ACCOUNTS.hostId}`]: "host_abc",
    [`${MOSHI_KEYCHAIN_SERVICE}|${MOSHI_KEYCHAIN_ACCOUNTS.hostSecret}`]:
      "secret_xyz",
    [`${MOSHI_KEYCHAIN_SERVICE}|${MOSHI_KEYCHAIN_ACCOUNTS.hostDisplayName}`]:
      "poi",
  });

  test("reads all three entries and trims the trailing newline", () => {
    const creds = readMoshiSecretsFromKeychain({ read: FULL });
    expect(creds).toEqual({
      hostId: "host_abc",
      hostSecret: "secret_xyz",
      hostName: "poi",
      baseUrl: MOSHI_BASE_URL,
    });
  });

  test("returns null when host-id and host-secret are both missing", () => {
    const creds = readMoshiSecretsFromKeychain({ read: makeKeychain({}) });
    expect(creds).toBeNull();
  });

  test("returns null when only host-id is present (no host-secret)", () => {
    const creds = readMoshiSecretsFromKeychain({
      read: makeKeychain({
        [`${MOSHI_KEYCHAIN_SERVICE}|${MOSHI_KEYCHAIN_ACCOUNTS.hostId}`]:
          "host_abc",
      }),
    });
    expect(creds).toBeNull();
  });

  test("omits hostName gracefully when host-display-name is absent", () => {
    const creds = readMoshiSecretsFromKeychain({
      read: makeKeychain({
        [`${MOSHI_KEYCHAIN_SERVICE}|${MOSHI_KEYCHAIN_ACCOUNTS.hostId}`]:
          "host_abc",
        [`${MOSHI_KEYCHAIN_SERVICE}|${MOSHI_KEYCHAIN_ACCOUNTS.hostSecret}`]:
          "secret_xyz",
      }),
    });
    expect(creds?.hostId).toBe("host_abc");
    expect(creds?.hostName).toBe("");
  });

  test("honors a custom service name", () => {
    const custom = "my.moshi";
    const creds = readMoshiSecretsFromKeychain({
      service: custom,
      read: makeKeychain({
        [`${custom}|${MOSHI_KEYCHAIN_ACCOUNTS.hostId}`]: "host_z",
        [`${custom}|${MOSHI_KEYCHAIN_ACCOUNTS.hostSecret}`]: "s",
        [`${custom}|${MOSHI_KEYCHAIN_ACCOUNTS.hostDisplayName}`]: "box",
      }),
    });
    expect(creds?.hostId).toBe("host_z");
    expect(creds?.hostName).toBe("box");
  });
});
