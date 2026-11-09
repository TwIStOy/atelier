import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierContext, ClassifierModel } from "@earendil-works/pi-ai";
import { clearConfigItems, setConfigKey, writeConfig } from "@htwang-contrib/common/config";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MagpieClassifierError, magpieSystemOneClassifier } from "../src/classifier.ts";
import { MAGPIE_CONFIG_ID } from "../src/config.ts";

type SystemOneModel = ClassifierModel<"typesafe-system-one">;

function makeModel(overrides: Partial<SystemOneModel> = {}): SystemOneModel {
  return {
    type: "classifier",
    api: "typesafe-system-one",
    provider: "magpie",
    id: "jev-latest",
    name: "jev-latest",
    baseUrl: "http://gateway.invalid/v1",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_768,
    ...overrides,
  } as SystemOneModel;
}

const context: ClassifierContext = {
  state: { command: "rm -rf build", cwd: "/repo" },
  questions: {
    destructive: {
      type: "bool",
      instructions: "Is `command` destructive?",
      criteria: { true: "Yes", false: "No" },
    },
    tier: {
      type: "choice",
      instructions: "Pick a tier.",
      criteria: { flash: "Simple edits", flagship: "Broad changes" },
    },
    depth: {
      type: "score",
      instructions: "How deep is the reasoning?",
      criteria: ["shallow", "deep"],
    },
  },
};

const wireResult = {
  model: "jev-1.14.0",
  answers: {
    destructive: { type: "noul", noul: 0.9 },
    tier: {
      type: "choice",
      choice: "flash",
      confidence: 0.7,
      probabilities: { flash: 0.8, flagship: 0.2 },
    },
    depth: { type: "score", score: 1.2, confidence: 0.6 },
  },
  usage: { input_tokens: 120, output_tokens: 12 },
};

function successfulFetch() {
  return vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json(wireResult));
}

describe("magpie system one classifier", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "pi-magpie-"));
    vi.stubEnv("XDG_CONFIG_HOME", configDir);
    vi.stubEnv("MAGPIE_BASE_URL", "");
    vi.stubEnv("MAGPIE_API_KEY", "");
    clearConfigItems(MAGPIE_CONFIG_ID);
    writeConfig(MAGPIE_CONFIG_ID, { apiKey: "saved-key" });
  });

  afterEach(() => {
    clearConfigItems(MAGPIE_CONFIG_ID);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(configDir, { recursive: true, force: true });
  });

  test("posts to <baseUrl>/systemone, maps bool to noul, and returns typed answers", async () => {
    const fetcher = successfulFetch();
    const result = await magpieSystemOneClassifier.classify(makeModel(), context, {
      fetch: fetcher,
      apiKey: " call-key ",
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("http://gateway.invalid/v1/systemone");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer call-key");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "jev-latest",
      state: context.state,
      questions: {
        destructive: {
          type: "noul",
          instructions: "Is `command` destructive?",
          criteria: { true: "Yes", false: "No" },
        },
        tier: context.questions.tier,
        depth: context.questions.depth,
      },
    });
    expect(result).toEqual({
      api: "typesafe-system-one",
      provider: "magpie",
      model: "jev-latest",
      answers: {
        destructive: { type: "bool", probability: 0.9 },
        tier: { type: "choice", choice: "flash", confidence: 0.7, probabilities: { flash: 0.8, flagship: 0.2 } },
        depth: { type: "score", score: 1.2, confidence: 0.6 },
      },
      usage: {
        input: 120,
        output: 12,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 132,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: expect.any(Number),
    });
  });

  test("falls back to the configured key and retries a transient status once", async () => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ error: "busy" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json(wireResult));

    const result = await magpieSystemOneClassifier.classify(makeModel(), context, {
      fetch: fetcher,
      maxRetries: 1,
    });
    expect(result.answers.destructive).toEqual({ type: "bool", probability: 0.9 });
    expect(fetcher.mock.calls.map(([, init]) => new Headers(init?.headers).get("Authorization"))).toEqual([
      "Bearer saved-key",
      "Bearer saved-key",
    ]);
  });

  test("merges a caller-supplied authorization header instead of duplicating it", async () => {
    const fetcher = successfulFetch();
    await magpieSystemOneClassifier.classify(makeModel(), context, {
      fetch: fetcher,
      apiKey: "key-from-api",
      headers: { Authorization: "Bearer key-from-headers" },
    });
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer key-from-headers");
    expect(headers.get("content-type")).toBe("application/json");
  });

  test("does not retry a rejected request", async () => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ detail: "bad request" }, { status: 400 }));

    await expect(magpieSystemOneClassifier.classify(makeModel(), context, { fetch: fetcher })).rejects.toMatchObject({
      status: 400,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("times out an attempt using the configured timeout", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) throw new Error("Expected an abort signal");
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    setConfigKey(MAGPIE_CONFIG_ID, "classifierTimeoutMs", 10);

    await expect(magpieSystemOneClassifier.classify(makeModel(), context, { fetch: fetcher })).rejects.toThrow(
      "timed out",
    );
  });

  test("rejects an aborted request without calling the gateway", async () => {
    const fetcher = successfulFetch();
    const controller = new AbortController();
    controller.abort(new Error("turn cancelled"));

    await expect(
      magpieSystemOneClassifier.classify(makeModel(), context, { fetch: fetcher, signal: controller.signal }),
    ).rejects.toThrow("aborted");
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("rejects a blank key before contacting the gateway", async () => {
    setConfigKey(MAGPIE_CONFIG_ID, "apiKey", "   ");
    const fetcher = successfulFetch();
    await expect(magpieSystemOneClassifier.classify(makeModel(), context, { fetch: fetcher })).rejects.toThrow(
      "MAGPIE_API_KEY",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("rejects an invalid response body or missing answers", async () => {
    const notJson = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("not json", { status: 200 }));
    await expect(magpieSystemOneClassifier.classify(makeModel(), context, { fetch: notJson })).rejects.toBeInstanceOf(
      MagpieClassifierError,
    );

    const noAnswers = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ model: "jev-1.14.0", usage: { input_tokens: 1, output_tokens: 1 } }));
    await expect(magpieSystemOneClassifier.classify(makeModel(), context, { fetch: noAnswers })).rejects.toThrow(
      "no answers",
    );
  });
});
