import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { loadConfig as loadConfigType } from "../src/config.ts";

let tmpDir: string;
let loadConfig: typeof loadConfigType;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "todo-config-"));
  vi.stubEnv("XDG_CONFIG_HOME", tmpDir);
  const mod = await import("../src/config.ts");
  loadConfig = mod.loadConfig;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
});

describe("loadConfig", () => {
  it("returns {} when no config file exists (empty dir)", () => {
    expect(loadConfig()).toEqual({});
  });

  it("reads the 'todo' section when present", () => {
    const configDir = join(tmpDir, "pi");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "extensions.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        todo: {
          guidance: {
            promptSnippet: "custom snippet",
            promptGuidelines: ["rule1", "rule2"],
          },
        },
      }),
    );
    const cfg = loadConfig();
    expect(cfg.guidance?.promptSnippet).toBe("custom snippet");
    expect(cfg.guidance?.promptGuidelines).toEqual(["rule1", "rule2"]);
  });

  it("returns {} when the file exists but has no 'todo' section", () => {
    const configDir = join(tmpDir, "pi");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "extensions.json");
    writeFileSync(configPath, JSON.stringify({ other: { foo: "bar" } }));
    const cfg = loadConfig();
    expect(cfg).toEqual({});
  });

  it("returns {} when the JSON is malformed", () => {
    const configDir = join(tmpDir, "pi");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "extensions.json");
    writeFileSync(configPath, "{ not valid json");
    const cfg = loadConfig();
    expect(cfg).toEqual({});
  });
});
