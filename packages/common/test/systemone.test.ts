import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { systemOne as publicSystemOne } from "@htwang-contrib/common";
import {
  loadSystemOneConfig,
  registerSystemOneConfigItems,
  SYSTEM_ONE_CONFIG_ID,
  SystemOneAbortError,
  SystemOneAPIError,
  SystemOneConnectionError,
  SystemOneError,
  type SystemOneRequest,
  type SystemOneResult,
  SystemOneTimeoutError,
  systemOne,
  systemOneChoice,
  systemOneNoul,
  systemOneScore,
} from "@htwang-contrib/common/systemone";
import { afterEach, beforeEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { clearConfigItems, getConfigItems, setConfigKey, writeConfig } from "../src/config/index.ts";

const request = {
  state: { ticket: "I was charged twice and need a refund today.", customer: { paid: true } },
  questions: {
    billing: systemOneNoul({ task: "Does `ticket` describe a billing problem?" }, { true: ["Duplicate charges"] }),
    route: systemOneChoice("Which team should handle `ticket`?", {
      billing: { includes: ["Charges", "Refunds"] },
      support: "Technical problems",
      other: null,
    }),
    urgency: systemOneScore(
      ["How urgently does `ticket` need a response?"],
      ["No time pressure", { deadline: "Soon" }, "Today"],
    ),
  },
} satisfies SystemOneRequest;

const result = {
  model: "jev-1.13.0",
  answers: {
    billing: { type: "noul", noul: 0.99 },
    route: {
      type: "choice",
      choice: "billing",
      probabilities: { billing: 0.98, support: 0.01, other: 0.01 },
      confidence: 0.9,
    },
    urgency: {
      type: "score",
      score: 1.9,
      legend: { "0": "No time pressure", "1": { deadline: "Soon" }, "2": "Today" },
      probabilities: { "0": 0, "1": 0.1, "2": 0.9 },
      confidence: 0.8,
    },
  },
  usage: { input_tokens: 200, output_tokens: 20 },
} satisfies SystemOneResult<typeof request.questions>;

function successfulFetch() {
  return vi.fn<typeof fetch>().mockImplementation(async () => Response.json(result));
}

function stalledFetch() {
  return vi.fn<typeof fetch>().mockImplementation(
    async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error("Expected an abort signal");
        signal.throwIfAborted();
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  );
}

describe("System One", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "pi-systemone-"));
    vi.stubEnv("XDG_CONFIG_HOME", configDir);
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubEnv("TYPESAFE_BASE_URL", "");
    vi.stubEnv("TYPESAFE_DEFAULT_MODEL", "");
    vi.stubEnv("TYPESAFE_LOG_LEVEL", "debug");
    clearConfigItems(SYSTEM_ONE_CONFIG_ID);
  });

  afterEach(() => {
    clearConfigItems(SYSTEM_ONE_CONFIG_ID);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    rmSync(configDir, { recursive: true, force: true });
  });

  test("sends all primitives through the public export and preserves inferred answers", async () => {
    const fetcher = successfulFetch();
    const response = await publicSystemOne(request, { apiKey: " test-key ", fetch: fetcher });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-key");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ ...request, model: "jev-latest" });
    expect(response).toEqual(result);
    expectTypeOf(response.answers.route.choice).toEqualTypeOf<"billing" | "support" | "other">();
    expectTypeOf(response.answers.billing.noul).toEqualTypeOf<number>();
    expectTypeOf(response.answers.urgency.probabilities).toEqualTypeOf<{
      readonly "0": number;
      readonly "1": number;
      readonly "2": number;
    }>();
  });

  test("uses persisted settings, then environment overrides, then explicit call overrides", async () => {
    writeConfig(SYSTEM_ONE_CONFIG_ID, {
      apiKey: "saved-key",
      baseUrl: "https://saved.example/api///",
      model: "saved-model",
    });
    const fetcher = successfulFetch();
    await systemOne(request, { fetch: fetcher });

    vi.stubEnv("TYPESAFE_API_KEY", " env-key ");
    vi.stubEnv("TYPESAFE_BASE_URL", " https://env.example/api/ ");
    vi.stubEnv("TYPESAFE_DEFAULT_MODEL", " env-model ");
    await systemOne(request, { fetch: fetcher });

    await systemOne(
      { ...request, model: "call-model" },
      { apiKey: "call-key", baseUrl: "https://call.example/api/", fetch: fetcher },
    );

    expect(
      fetcher.mock.calls.map(([url, init]) => ({
        url,
        auth: new Headers(init?.headers).get("Authorization"),
        model: JSON.parse(String(init?.body)).model,
      })),
    ).toEqual([
      { url: "https://saved.example/api/v1/systemone", auth: "Bearer saved-key", model: "saved-model" },
      { url: "https://env.example/api/v1/systemone", auth: "Bearer env-key", model: "env-model" },
      { url: "https://call.example/api/v1/systemone", auth: "Bearer call-key", model: "call-model" },
    ]);
  });

  test("registers shared config items and observes configuration edits on the next call", async () => {
    registerSystemOneConfigItems();
    registerSystemOneConfigItems();
    const items = getConfigItems(SYSTEM_ONE_CONFIG_ID);
    expect(items.map((item) => item.key)).toEqual(["apiKey", "baseUrl", "model", "timeoutMs", "maxRetries"]);
    expect(items[0]).toMatchObject({ secret: true, envVar: "TYPESAFE_API_KEY" });
    expect(loadSystemOneConfig()).toMatchObject({ timeoutMs: 10_000, maxRetries: 2 });

    setConfigKey(SYSTEM_ONE_CONFIG_ID, "apiKey", "first-key");
    const fetcher = successfulFetch();
    await systemOne(request, { fetch: fetcher });
    setConfigKey(SYSTEM_ONE_CONFIG_ID, "apiKey", "second-key");
    setConfigKey(SYSTEM_ONE_CONFIG_ID, "model", "updated-model");
    await systemOne(request, { fetch: fetcher });

    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer first-key");
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get("Authorization")).toBe("Bearer second-key");
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).model).toBe("updated-model");
    const modelItem = items.find((item) => item.key === "model");
    expect(typeof modelItem?.value === "function" && modelItem.value()).toBe("updated-model");
  });

  test("rejects missing or explicitly blank credentials before contacting the API", async () => {
    const fetcher = successfulFetch();
    await expect(systemOne(request, { fetch: fetcher })).rejects.toThrow("TYPESAFE_API_KEY");
    vi.stubEnv("TYPESAFE_API_KEY", "env-key");
    await expect(systemOne(request, { apiKey: "  ", fetch: fetcher })).rejects.toBeInstanceOf(SystemOneError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("accepts null state and plain question objects", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        model: "jev-1.13.0",
        answers: { check: { type: "noul", noul: 1 } },
        usage: { input_tokens: 10, output_tokens: 1 },
      }),
    );
    const response = await systemOne(
      { state: null, questions: { check: { type: "noul", instructions: "Is water wet?" } } },
      { apiKey: "test-key", fetch: fetcher },
    );
    expect(response.answers.check.noul).toBe(1);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).state).toBeNull();
    expectTypeOf(response.answers.check.noul).toEqualTypeOf<number>();
  });

  test("rejects empty question sets before contacting the API", async () => {
    const fetcher = successfulFetch();
    await expect(
      systemOne({ state: "test", questions: {} }, { apiKey: "test-key", fetch: fetcher }),
    ).rejects.toBeInstanceOf(SystemOneError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each([401, 422])("preserves HTTP %i errors and request IDs without retrying", async (status) => {
    const body = { detail: "Request rejected" };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json(body, { status, headers: { "x-typesafe-request-id": "request-123" } }),
      );
    const pending = systemOne(request, { apiKey: "test-key", fetch: fetcher });
    await expect(pending).rejects.toBeInstanceOf(SystemOneAPIError);
    await expect(pending).rejects.toMatchObject({ status, body, requestId: "request-123" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test.each([429, 529, 503])("retries HTTP %i and returns the successful result", async (status) => {
    const fetcher = successfulFetch().mockResolvedValueOnce(Response.json({ error: "Try again" }, { status }));
    const response = await systemOne(request, {
      apiKey: "test-key",
      fetch: fetcher,
      retry: { maxRetries: 1, backoffInitialMs: 0 },
    });
    expect(response).toEqual(result);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("honors configured and per-call retry limits", async () => {
    setConfigKey(SYSTEM_ONE_CONFIG_ID, "maxRetries", 0);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ error: "Busy" }, { status: 503 }));
    await expect(systemOne(request, { apiKey: "test-key", fetch: fetcher })).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(1);

    fetcher.mockClear();
    await expect(
      systemOne(request, { apiKey: "test-key", fetch: fetcher, retry: { maxRetries: undefined } }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(1);

    fetcher.mockClear();
    await expect(
      systemOne(request, { apiKey: "test-key", fetch: fetcher, retry: { maxRetries: 1, backoffInitialMs: 0 } }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("preserves connection errors when retries are disabled", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Connection closed"));
    await expect(
      systemOne(request, { apiKey: "test-key", fetch: fetcher, retry: { maxRetries: 0 } }),
    ).rejects.toBeInstanceOf(SystemOneConnectionError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("aborts without a request when the caller signal is already cancelled", async () => {
    const fetcher = successfulFetch();
    await expect(systemOne(request, { signal: AbortSignal.abort(), fetch: fetcher })).rejects.toBeInstanceOf(
      SystemOneAbortError,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("cancels an in-flight request without retrying", async () => {
    const controller = new AbortController();
    const fetcher = stalledFetch();
    const pending = systemOne(request, { apiKey: "test-key", signal: controller.signal, fetch: fetcher });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(SystemOneAbortError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("cancels while waiting for a retry", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Connection closed"));
    const pending = systemOne(request, {
      apiKey: "test-key",
      fetch: fetcher,
      signal: controller.signal,
      retry: { backoffInitialMs: 1000, backoffJitter: 0 },
    });
    const assertion = expect(pending).rejects.toBeInstanceOf(SystemOneAbortError);
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([undefined, 20])("applies timeout configuration with per-call override %s", async (timeout) => {
    vi.useFakeTimers();
    setConfigKey(SYSTEM_ONE_CONFIG_ID, "timeoutMs", 50);
    setConfigKey(SYSTEM_ONE_CONFIG_ID, "maxRetries", 0);
    const fetcher = stalledFetch();
    const pending = systemOne(request, { apiKey: "test-key", fetch: fetcher, timeout });
    const assertion = expect(pending).rejects.toMatchObject({ timeoutMs: timeout ?? 50 });
    await vi.advanceTimersByTimeAsync(timeout ?? 50);
    await assertion;
    await expect(pending).rejects.toBeInstanceOf(SystemOneTimeoutError);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("forwards custom headers and keeps SDK console logging disabled", async () => {
    const spies = ["debug", "info", "warn", "error"].map((level) =>
      vi.spyOn(console, level as "debug" | "info" | "warn" | "error").mockImplementation(() => {}),
    );
    const fetcher = successfulFetch();
    await systemOne(request, { apiKey: "test-key", fetch: fetcher, headers: { "X-Consumer": "example" } });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("X-Consumer")).toBe("example");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
