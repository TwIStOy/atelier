import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetHttpDeps, SttError, setHttpDeps, transcribeWithMimoChat } from "../src/providers/mimo-stt.ts";

const CONFIG = { baseUrl: "https://inference.example/v1", model: "mimo-v2.5" };
const API_KEY = "sk-secret-abc";

let tmpDir: string;
let wavFile: string;
let fetchCalls: Array<{ url: string; init?: RequestInit }>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "voice-mimo-"));
  wavFile = join(tmpDir, "recording.wav");
  writeFileSync(wavFile, Buffer.from([0x52, 0x49, 0x46, 0x46]));
  fetchCalls = [];
});

afterEach(() => {
  resetHttpDeps();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

function stubFetch(
  respond: (
    url: string,
    init?: RequestInit,
  ) => { ok: true; body: unknown } | { ok: false; status: number; body: string },
): void {
  setHttpDeps({
    fetch: (async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      const r = respond(url, init);
      return {
        ok: r.ok,
        status: r.ok ? 200 : r.status,
        json: async () => (r.ok ? r.body : {}),
        text: async () => (r.ok ? JSON.stringify(r.body) : r.body),
      } as Response;
    }) as typeof fetch,
  });
}

function lastBody(): Record<string, unknown> {
  const init = fetchCalls[fetchCalls.length - 1]?.init;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe("transcribeWithMimoChat — success", () => {
  it("returns choices[0].message.content, trimmed", async () => {
    stubFetch(() => ({
      ok: true,
      body: { choices: [{ message: { content: "  hello world  " } }] },
    }));
    const text = await transcribeWithMimoChat(wavFile, CONFIG, API_KEY);
    expect(text).toBe("hello world");
  });

  it("falls back to reasoning_content when content is absent", async () => {
    stubFetch(() => ({
      ok: true,
      body: {
        choices: [{ message: { reasoning_content: "from reasoning" } }],
      },
    }));
    const text = await transcribeWithMimoChat(wavFile, CONFIG, API_KEY);
    expect(text).toBe("from reasoning");
  });

  it("prefers content over reasoning_content", async () => {
    stubFetch(() => ({
      ok: true,
      body: {
        choices: [
          {
            message: { content: "primary", reasoning_content: "secondary" },
          },
        ],
      },
    }));
    expect(await transcribeWithMimoChat(wavFile, CONFIG, API_KEY)).toBe("primary");
  });

  it("sends OpenAI-standard input_audio (pure base64, format, no data URL)", async () => {
    stubFetch(() => ({
      ok: true,
      body: { choices: [{ message: { content: "x" } }] },
    }));
    await transcribeWithMimoChat(wavFile, CONFIG, API_KEY);
    const body = lastBody();
    expect(body.model).toBe("mimo-v2.5");
    expect(body.max_completion_tokens).toBe(4096);
    const content = (body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0].content;
    const audioBlock = content.find((b) => b.type === "input_audio");
    expect(audioBlock?.input_audio).toMatchObject({ format: "wav" });
    const data = (audioBlock?.input_audio as { data: string }).data;
    expect(data).not.toMatch(/^data:/);
    expect(data).not.toContain(",");
    expect(Buffer.from(data, "base64")).toEqual(Buffer.from([0x52, 0x49, 0x46, 0x46]));
  });

  it(`posts to ${CONFIG.baseUrl}/chat/completions with Bearer auth header`, async () => {
    stubFetch(() => ({
      ok: true,
      body: { choices: [{ message: { content: "x" } }] },
    }));
    await transcribeWithMimoChat(wavFile, CONFIG, API_KEY);
    const call = fetchCalls[fetchCalls.length - 1];
    expect(call.url).toBe("https://inference.example/v1/chat/completions");
    const headers = call.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("transcribeWithMimoChat — empty transcript", () => {
  it("throws empty_transcript on '[NO SPEECH]'", async () => {
    stubFetch(() => ({
      ok: true,
      body: { choices: [{ message: { content: "[NO SPEECH]" } }] },
    }));
    await expect(transcribeWithMimoChat(wavFile, CONFIG, API_KEY)).rejects.toMatchObject({
      code: "empty_transcript",
    });
  });

  it("throws empty_transcript on empty content + empty reasoning", async () => {
    stubFetch(() => ({ ok: true, body: { choices: [{ message: {} }] } }));
    await expect(transcribeWithMimoChat(wavFile, CONFIG, API_KEY)).rejects.toMatchObject({
      code: "empty_transcript",
    });
  });

  it("throws empty_transcript when choices array is missing", async () => {
    stubFetch(() => ({ ok: true, body: {} }));
    await expect(transcribeWithMimoChat(wavFile, CONFIG, API_KEY)).rejects.toMatchObject({
      code: "empty_transcript",
    });
  });
});

describe("transcribeWithMimoChat — HTTP errors", () => {
  it("maps 401 to auth_error", async () => {
    stubFetch(() => ({ ok: false, status: 401, body: "unauthorized" }));
    await expect(transcribeWithMimoChat(wavFile, CONFIG, API_KEY)).rejects.toMatchObject({
      code: "auth_error",
    });
  });

  it("maps 403 to auth_error", async () => {
    stubFetch(() => ({ ok: false, status: 403, body: "forbidden" }));
    await expect(transcribeWithMimoChat(wavFile, CONFIG, API_KEY)).rejects.toMatchObject({
      code: "auth_error",
    });
  });

  it("maps 500 to api_error", async () => {
    stubFetch(() => ({ ok: false, status: 500, body: "boom" }));
    await expect(transcribeWithMimoChat(wavFile, CONFIG, API_KEY)).rejects.toMatchObject({
      code: "api_error",
    });
  });

  it("redacts the API key from the failure message", async () => {
    stubFetch(() => ({ ok: false, status: 500, body: `leak ${API_KEY}` }));
    await expect(transcribeWithMimoChat(wavFile, CONFIG, API_KEY)).rejects.toThrow();
    const err = await transcribeWithMimoChat(wavFile, CONFIG, API_KEY).catch((e) => e);
    expect(err.message).not.toContain(API_KEY);
    expect(err.message).toContain("<redacted>");
  });

  it("includes the status code in the error message", async () => {
    stubFetch(() => ({ ok: false, status: 502, body: "bad gateway" }));
    const err = await transcribeWithMimoChat(wavFile, CONFIG, API_KEY).catch((e) => e);
    expect(err.message).toMatch(/502/);
  });
});

describe("transcribeWithMimoChat — network errors", () => {
  it("maps fetch rejection to network_error", async () => {
    setHttpDeps({
      fetch: (async () => {
        throw new TypeError(`fetch failed with key ${API_KEY}`);
      }) as typeof fetch,
    });
    const err = await transcribeWithMimoChat(wavFile, CONFIG, API_KEY).catch((e) => e);
    expect(err).toBeInstanceOf(SttError);
    expect(err.code).toBe("network_error");
    expect(err.message).not.toContain(API_KEY);
  });

  it("does not swallow an already-thrown SttError", async () => {
    const sttErr = new SttError("auth_error", "prethrown");
    setHttpDeps({
      fetch: (async () => {
        throw sttErr;
      }) as typeof fetch,
    });
    await expect(transcribeWithMimoChat(wavFile, CONFIG, API_KEY)).rejects.toBe(sttErr);
  });
});

describe("transcribeWithMimoChat — abort signal", () => {
  it("forwards the AbortSignal through to fetch", async () => {
    stubFetch(() => ({
      ok: true,
      body: { choices: [{ message: { content: "x" } }] },
    }));
    const controller = new AbortController();
    await transcribeWithMimoChat(wavFile, CONFIG, API_KEY, controller.signal);
    const call = fetchCalls[fetchCalls.length - 1];
    expect(call.init?.signal).toBe(controller.signal);
  });
});

describe("SttError", () => {
  it("carries code and message", () => {
    const err = new SttError("empty_transcript", "No speech detected.");
    expect(err.code).toBe("empty_transcript");
    expect(err.message).toBe("No speech detected.");
    expect(err.name).toBe("SttError");
    expect(err).toBeInstanceOf(Error);
  });

  it("covers all documented codes", () => {
    const codes: Array<SttError["code"]> = [
      "missing_api_key",
      "network_error",
      "auth_error",
      "api_error",
      "empty_transcript",
    ];
    expect(codes).toHaveLength(5);
  });
});
