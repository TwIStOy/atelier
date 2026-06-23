import { describe, expect, test } from "vitest";
import { readMoshiSecretsFromFile, resolveStateDir } from "./moshi-secrets.ts";

function makeFs(files: Record<string, string>) {
  return {
    existsSync: (p: string): boolean =>
      Object.prototype.hasOwnProperty.call(files, p),
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

describe("resolveStateDir", () => {
  test("prefers XDG_STATE_HOME", () => {
    expect(resolveStateDir({ XDG_STATE_HOME: "/xdg/state" })).toBe(
      "/xdg/state",
    );
  });

  test("falls back to HOME/.local/state", () => {
    expect(resolveStateDir({ HOME: "/home/u" }, "/home/u")).toBe(
      "/home/u/.local/state",
    );
  });
});
