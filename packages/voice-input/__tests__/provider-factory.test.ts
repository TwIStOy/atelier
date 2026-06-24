import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSttProvider, SttError } from "../providers/index.ts";
import { resetHttpDeps, setHttpDeps } from "../providers/mimo-stt.ts";

const ENV_VAR = "INFERENCE_TWISTOY_API_KEY";

let tmpDir: string;
let wavFile: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "voice-factory-"));
  vi.stubEnv("XDG_CONFIG_HOME", tmpDir);
  vi.stubEnv(ENV_VAR, "");
  wavFile = join(tmpDir, "recording.wav");
  writeFileSync(wavFile, Buffer.from("audio"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  resetHttpDeps();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("createSttProvider — missing API key", () => {
  it("throws missing_api_key when neither config nor env provides a key", async () => {
    await expect(createSttProvider("inference-self-host")).rejects.toMatchObject({
      code: "missing_api_key",
    });
  });

  it("mentions /config in the error guidance", async () => {
    const err = await createSttProvider("inference-self-host").catch((e) => e);
    expect(err.message).toMatch(/\/config/);
    expect(err).toBeInstanceOf(SttError);
  });
});

describe("createSttProvider — happy path", () => {
  it("resolves a provider that delegates transcribe to transcribeWithMimoChat", async () => {
    vi.stubEnv(ENV_VAR, "sk-from-env");
    const calls: Array<{ url: string; auth?: string }> = [];
    setHttpDeps({
      fetch: (async (url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        calls.push({ url, auth: headers?.Authorization });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: "transcribed text" } }],
          }),
          text: async () => "",
        } as Response;
      }) as typeof fetch,
    });

    const provider = await createSttProvider("inference-self-host");
    const text = await provider.transcribe(wavFile);
    expect(text).toBe("transcribed text");
    expect(calls[0].url).toBe("https://inference.twistoy.cn/v1/chat/completions");
    expect(calls[0].auth).toBe("Bearer sk-from-env");
  });

  it("forwards the abort signal through the provider", async () => {
    vi.stubEnv(ENV_VAR, "sk-from-env");
    let seenSignal: AbortSignal | undefined;
    setHttpDeps({
      fetch: (async (_url: string, init?: RequestInit) => {
        seenSignal = init?.signal as AbortSignal | undefined;
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: "ok" } }] }),
          text: async () => "",
        } as Response;
      }) as typeof fetch,
    });

    const provider = await createSttProvider("inference-self-host");
    const controller = new AbortController();
    await provider.transcribe(wavFile, controller.signal);
    expect(seenSignal).toBe(controller.signal);
  });
});
