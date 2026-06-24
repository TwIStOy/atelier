import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "voice-input-config-"));
  vi.stubEnv("XDG_CONFIG_HOME", tmpDir);
  vi.stubEnv("INFERENCE_TWISTOY_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
});

function writeConfig(section: Record<string, unknown>): void {
  const configDir = join(tmpDir, "pi");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "extensions.json"), JSON.stringify({ "voice-input": section }));
}

describe("loadConfig", () => {
  it("returns defaults when no config file exists", async () => {
    const { loadConfig, DEFAULT_VAD_CONFIG } = await import("../src/config.ts");
    expect(loadConfig()).toEqual({
      provider: "inference-self-host",
      providers: {},
      recorder: "auto",
      micDevice: "",
      transcribeTimeoutMs: 60_000,
      vad: DEFAULT_VAD_CONFIG,
    });
  });

  it("returns defaults when the voice-input section is missing", async () => {
    const configDir = join(tmpDir, "pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "extensions.json"), JSON.stringify({ other: { foo: "bar" } }));
    const { loadConfig } = await import("../src/config.ts");
    expect(loadConfig().provider).toBe("inference-self-host");
  });

  it("overrides top-level fields from the section", async () => {
    const { DEFAULT_VAD_CONFIG } = await import("../src/config.ts");
    writeConfig({
      provider: "inference-self-host",
      recorder: "ffmpeg",
      micDevice: ":0",
      transcribeTimeoutMs: 12_000,
      vad: DEFAULT_VAD_CONFIG,
    });
    const { loadConfig } = await import("../src/config.ts");
    expect(loadConfig()).toMatchObject({
      recorder: "ffmpeg",
      micDevice: ":0",
      transcribeTimeoutMs: 12_000,
    });
  });
});

describe("resolveApiKey", () => {
  it("returns undefined when neither config nor env is set", async () => {
    const { resolveApiKey } = await import("../src/config.ts");
    expect(resolveApiKey("inference-self-host")).toBeUndefined();
  });

  it("uses the config key when present (priority over env)", async () => {
    vi.stubEnv("INFERENCE_TWISTOY_API_KEY", "env-key");
    writeConfig({
      providers: { "inference-self-host": { apiKey: "cfg-key" } },
    });
    const { resolveApiKey } = await import("../src/config.ts");
    expect(resolveApiKey("inference-self-host")).toBe("cfg-key");
  });

  it("falls back to the preset env var when config has no key", async () => {
    vi.stubEnv("INFERENCE_TWISTOY_API_KEY", "env-key");
    const { resolveApiKey } = await import("../src/config.ts");
    expect(resolveApiKey("inference-self-host")).toBe("env-key");
  });

  it("ignores a blank env value", async () => {
    vi.stubEnv("INFERENCE_TWISTOY_API_KEY", "   ");
    const { resolveApiKey } = await import("../src/config.ts");
    expect(resolveApiKey("inference-self-host")).toBeUndefined();
  });

  it("trims a config key with surrounding whitespace", async () => {
    writeConfig({ providers: { "inference-self-host": { apiKey: "  sp  " } } });
    const { resolveApiKey } = await import("../src/config.ts");
    expect(resolveApiKey("inference-self-host")).toBe("sp");
  });

  it("returns undefined for an unknown provider", async () => {
    const { resolveApiKey } = await import("../src/config.ts");
    expect(resolveApiKey("nope")).toBeUndefined();
  });
});

describe("resolveProviderConfig", () => {
  it("uses preset defaults when config has no overrides", async () => {
    const { resolveProviderConfig } = await import("../src/config.ts");
    expect(resolveProviderConfig("inference-self-host")).toEqual({
      baseUrl: "https://inference.twistoy.cn/v1",
      model: "mimo-v2.5",
    });
  });

  it("overrides model while keeping preset baseUrl", async () => {
    writeConfig({
      providers: { "inference-self-host": { model: "mimo-v3" } },
    });
    const { resolveProviderConfig } = await import("../src/config.ts");
    expect(resolveProviderConfig("inference-self-host")).toEqual({
      baseUrl: "https://inference.twistoy.cn/v1",
      model: "mimo-v3",
    });
  });

  it("overrides baseUrl while keeping preset model", async () => {
    writeConfig({
      providers: {
        "inference-self-host": { baseUrl: "https://other.example/v1" },
      },
    });
    const { resolveProviderConfig } = await import("../src/config.ts");
    expect(resolveProviderConfig("inference-self-host")).toEqual({
      baseUrl: "https://other.example/v1",
      model: "mimo-v2.5",
    });
  });

  it("treats whitespace-only overrides as unset", async () => {
    writeConfig({
      providers: {
        "inference-self-host": { baseUrl: "  ", model: "\t" },
      },
    });
    const { resolveProviderConfig } = await import("../src/config.ts");
    expect(resolveProviderConfig("inference-self-host")).toEqual({
      baseUrl: "https://inference.twistoy.cn/v1",
      model: "mimo-v2.5",
    });
  });

  it("returns empty strings for an unknown provider (no preset)", async () => {
    const { resolveProviderConfig } = await import("../src/config.ts");
    expect(resolveProviderConfig("nope")).toEqual({ baseUrl: "", model: "" });
  });
});

describe("STT_PROVIDER_PRESETS", () => {
  it("every preset has the required fields populated", async () => {
    const { STT_PROVIDER_PRESETS } = await import("../src/providers/presets.ts");
    for (const p of STT_PROVIDER_PRESETS) {
      expect(p.name).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.baseUrl).toMatch(/^https?:\/\//);
      expect(p.defaultModel).toBeTruthy();
      expect(p.envVar).toBeTruthy();
      expect(p.protocol).toBe("chat-multimodal");
    }
  });

  it("includes the inference-self-host preset", async () => {
    const { STT_PROVIDER_PRESETS } = await import("../src/providers/presets.ts");
    expect(STT_PROVIDER_PRESETS.map((p) => p.name)).toContain("inference-self-host");
  });
});

describe("VAD config", () => {
  it("fills in missing vad sub-fields with defaults when only one is set", async () => {
    writeConfig({
      vad: { threshold: 0.7 },
    });
    const { loadConfig, DEFAULT_VAD_CONFIG } = await import("../src/config.ts");
    const cfg = loadConfig();
    expect(cfg.vad.threshold).toBe(0.7);
    expect(cfg.vad.enabled).toBe(DEFAULT_VAD_CONFIG.enabled);
    expect(cfg.vad.minSpeechMs).toBe(DEFAULT_VAD_CONFIG.minSpeechMs);
    expect(cfg.vad.minSilenceMs).toBe(DEFAULT_VAD_CONFIG.minSilenceMs);
    expect(cfg.vad.maxSpeechMs).toBe(DEFAULT_VAD_CONFIG.maxSpeechMs);
  });

  it("accepts a fully overridden vad config", async () => {
    writeConfig({
      vad: {
        enabled: true,
        threshold: 0.6,
        minSpeechMs: 300,
        minSilenceMs: 700,
        maxSpeechMs: 20000,
      },
    });
    const { loadConfig } = await import("../src/config.ts");
    const cfg = loadConfig();
    expect(cfg.vad).toEqual({
      enabled: true,
      threshold: 0.6,
      minSpeechMs: 300,
      minSilenceMs: 700,
      maxSpeechMs: 20000,
    });
  });
});
