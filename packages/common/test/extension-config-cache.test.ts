import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SCHEMA = { defaults: { n: 0, label: "default" } };

let tmpDir: string;
let configPath: string;
let mod: typeof import("../src/config/extension-config.ts");

function writeConfigFileExternally(section: Record<string, unknown>, mtime?: Date): void {
  writeFileSync(configPath, `${JSON.stringify({ demo: section })}\n`, "utf8");
  if (mtime) utimesSync(configPath, mtime, mtime);
}

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "common-config-cache-"));
  vi.stubEnv("XDG_CONFIG_HOME", tmpDir);
  mkdirSync(join(tmpDir, "pi"), { recursive: true });
  configPath = join(tmpDir, "pi", "extensions.json");
  mod = await import("../src/config/extension-config.ts");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
});

describe("readConfig file caching", () => {
  it("returns defaults when the file is missing", () => {
    expect(mod.readConfig("demo", SCHEMA)).toEqual({ n: 0, label: "default" });
  });

  it("serves repeated reads from cache with identical results", () => {
    writeConfigFileExternally({ n: 3 });
    expect(mod.readConfig("demo", SCHEMA)).toEqual({ n: 3, label: "default" });
    expect(mod.readConfig("demo", SCHEMA)).toEqual({ n: 3, label: "default" });
  });

  it("picks up external edits when the file mtime changes", () => {
    writeConfigFileExternally({ n: 1 }, new Date(2020, 0, 1));
    expect(mod.readConfig("demo", SCHEMA).n).toBe(1);
    writeConfigFileExternally({ n: 2 }, new Date(2021, 0, 1));
    expect(mod.readConfig("demo", SCHEMA).n).toBe(2);
  });

  it("returns defaults again after the file is deleted", () => {
    writeConfigFileExternally({ n: 5 });
    expect(mod.readConfig("demo", SCHEMA).n).toBe(5);
    rmSync(configPath);
    expect(mod.readConfig("demo", SCHEMA)).toEqual({ n: 0, label: "default" });
  });

  it("sees in-process writes immediately", () => {
    writeConfigFileExternally({ n: 1 });
    expect(mod.readConfig("demo", SCHEMA).n).toBe(1);
    mod.updateConfig("demo", SCHEMA, { n: 9 });
    expect(mod.readConfig("demo", SCHEMA).n).toBe(9);
  });
});

describe("getConfigFileVersion", () => {
  it("bumps on in-process writes", () => {
    const before = mod.getConfigFileVersion();
    mod.writeConfig("demo", { n: 1, label: "x" });
    expect(mod.getConfigFileVersion()).toBeGreaterThan(before);
  });

  it("bumps when an external change is observed", () => {
    writeConfigFileExternally({ n: 1 }, new Date(2020, 0, 1));
    mod.readConfig("demo", SCHEMA);
    const before = mod.getConfigFileVersion();
    writeConfigFileExternally({ n: 2 }, new Date(2021, 0, 1));
    mod.readConfig("demo", SCHEMA);
    expect(mod.getConfigFileVersion()).toBeGreaterThan(before);
  });

  it("stays stable across cached reads", () => {
    writeConfigFileExternally({ n: 1 });
    mod.readConfig("demo", SCHEMA);
    const before = mod.getConfigFileVersion();
    mod.readConfig("demo", SCHEMA);
    mod.readConfig("demo", SCHEMA);
    expect(mod.getConfigFileVersion()).toBe(before);
  });
});
