import { describe, expect, test } from "vitest";
import { readMoshiSecrets, readMoshiSecretsFromFile } from "../src/moshi-secrets.ts";

function makeFs(files: Record<string, string>) {
  return {
    existsSync: (p: string): boolean => Object.hasOwn(files, p),
    readFileSync: (p: string): string => files[p] ?? "",
  };
}

const SECRETS = JSON.stringify({
  "host-id": "host_abc",
  "host-secret": "secret_xyz",
  "host-display-name": "poi",
  "pairing-token": "tok",
});

describe("readMoshiSecretsFromFile", () => {
  test("reads Linux XDG state file", () => {
    const stateDir = "/home/u/.local/state";
    const creds = readMoshiSecretsFromFile({
      platform: "linux",
      stateDir,
      homeDir: "/home/u",
      ...makeFs({ [`${stateDir}/moshi/secrets.json`]: SECRETS }),
    });
    expect(creds).toEqual({
      hostId: "host_abc",
      hostSecret: "secret_xyz",
      hostName: "poi",
      baseUrl: "https://api.getmoshi.app/api/v1",
    });
  });

  test("reads macOS --store file path", () => {
    const home = "/Users/u";
    const creds = readMoshiSecretsFromFile({
      platform: "darwin",
      stateDir: `${home}/.local/state`,
      homeDir: home,
      ...makeFs({ [`${home}/.config/moshi/secrets.json`]: SECRETS }),
    });
    expect(creds?.hostId).toBe("host_abc");
  });

  test("returns null when file missing", () => {
    const creds = readMoshiSecretsFromFile({
      platform: "linux",
      stateDir: "/nope",
      homeDir: "/nope",
      ...makeFs({}),
    });
    expect(creds).toBeNull();
  });

  test("returns null when host-id or host-secret absent", () => {
    const stateDir = "/s";
    const creds = readMoshiSecretsFromFile({
      platform: "linux",
      stateDir,
      homeDir: "/s",
      ...makeFs({
        [`${stateDir}/moshi/secrets.json`]: JSON.stringify({
          "host-id": "host_abc",
        }),
      }),
    });
    expect(creds).toBeNull();
  });

  test("skips unparseable JSON and keeps looking", () => {
    const stateDir = "/s";
    const home = "/h";
    const creds = readMoshiSecretsFromFile({
      platform: "darwin",
      stateDir,
      homeDir: home,
      ...makeFs({
        [`${home}/.config/moshi/secrets.json`]: "not json",
        [`${stateDir}/moshi/secrets.json`]: SECRETS,
      }),
    });
    expect(creds?.hostId).toBe("host_abc");
  });
});

describe("readMoshiSecrets dispatcher", () => {
  const keychainRead = (service: string, account: string): string | undefined => {
    if (service !== "app.getmoshi.hook") return undefined;
    const map: Record<string, string> = {
      "host-id": "host_kc",
      "host-secret": "secret_kc",
      "host-display-name": "kc-host",
    };
    const v = map[account];
    return v === undefined ? undefined : `${v}\n`;
  };

  test("on darwin prefers the keychain over the file", () => {
    const stateDir = "/home/u/.local/state";
    const creds = readMoshiSecrets({
      platform: "darwin",
      stateDir,
      homeDir: "/home/u",
      readKeychain: keychainRead,
      ...makeFs({ [`${stateDir}/moshi/secrets.json`]: SECRETS }),
    });
    expect(creds?.hostId).toBe("host_kc");
    expect(creds?.hostSecret).toBe("secret_kc");
    expect(creds?.hostName).toBe("kc-host");
  });

  test("on darwin falls back to the file when the keychain is empty", () => {
    const stateDir = "/home/u/.local/state";
    const creds = readMoshiSecrets({
      platform: "darwin",
      stateDir,
      homeDir: "/home/u",
      readKeychain: () => undefined,
      ...makeFs({ [`${stateDir}/moshi/secrets.json`]: SECRETS }),
    });
    expect(creds?.hostId).toBe("host_abc");
  });

  test("on linux never consults the keychain", () => {
    const stateDir = "/home/u/.local/state";
    let keychainTouched = false;
    const creds = readMoshiSecrets({
      platform: "linux",
      stateDir,
      homeDir: "/home/u",
      readKeychain: () => {
        keychainTouched = true;
        return "unused";
      },
      ...makeFs({ [`${stateDir}/moshi/secrets.json`]: SECRETS }),
    });
    expect(keychainTouched).toBe(false);
    expect(creds?.hostId).toBe("host_abc");
  });

  test("returns null on darwin when neither keychain nor file has credentials", () => {
    const creds = readMoshiSecrets({
      platform: "darwin",
      stateDir: "/nope",
      homeDir: "/nope",
      readKeychain: () => undefined,
      ...makeFs({}),
    });
    expect(creds).toBeNull();
  });
});
