import { afterEach, describe, expect, test, vi } from "vitest";
import { classifierModelConfigs, fetchCatalog } from "../src/catalog.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const endpoint = { baseUrl: "http://100.65.0.3:3425/v1", apiKey: "magpie-private" };
const context = {
  allowNetwork: true,
  publish: async () => true,
  signal: new AbortController().signal,
};

describe("fetchCatalog", () => {
  test("maps a magpie routing group from /v1/models", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        data: [
          {
            context_length: 1048576,
            context_window: 1048576,
            display_name: "CN Flagships",
            id: "group/cn-flagships",
            magpie_label: "CN Flagships · routing group",
            max_input_tokens: 1048576,
            max_output_tokens: 131072,
            modalities: { input: ["text", "image"] },
            object: "model",
            owned_by: "kimi-code-cn",
            reasoning: true,
            reasoning_levels: ["low", "high", "max"],
            supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }, { effort: "max" }],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const [model] = await fetchCatalog(context, endpoint);
    if (!model || model.type === "classifier" || model.type === "image") throw new Error("Expected a chat model");

    expect(String(fetch.mock.calls[0]?.[0])).toBe("http://100.65.0.3:3425/v1/models");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ headers: { authorization: "Bearer magpie-private" } });
    expect(model).toMatchObject({
      id: "group/cn-flagships",
      name: "CN Flagships",
      api: "openai-completions",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1048576,
      maxTokens: 131072,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { sendSessionAffinityHeaders: true },
    });
    expect(model.thinkingLevelMap).toEqual({
      off: null,
      minimal: null,
      low: "low",
      medium: null,
      high: "high",
      xhigh: null,
      max: "max",
    });
  });

  test("keeps chat completions when it is a native endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            {
              id: "zai/glm-4.5",
              display_name: "GLM-4.5",
              context_window: 131072,
              max_output_tokens: 98304,
              native_endpoints: ["/v1/chat/completions", "/v1/responses", "/v1/messages"],
              pricing: { prompt: "0.0000006", completion: "0.0000022", input_cache_read: "0.00000011" },
              reasoning: true,
              reasoning_levels: [],
            },
          ],
        }),
      ),
    );

    const [model] = await fetchCatalog(context, endpoint);
    expect(model).toMatchObject({
      id: "zai/glm-4.5",
      api: "openai-completions",
      contextWindow: 131072,
      maxTokens: 98304,
      cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
    });
    expect(model).not.toHaveProperty("baseUrl");
    expect(model).not.toHaveProperty("thinkingLevelMap");
  });

  test("uses responses when chat completions is not native", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [{ id: "openai/gpt-6", native_endpoints: ["/v1/responses", "/v1/messages"] }],
        }),
      ),
    );

    const [model] = await fetchCatalog(context, endpoint);
    expect(model).toMatchObject({ api: "openai-responses" });
    expect(model).not.toHaveProperty("baseUrl");
  });

  test("uses anthropic messages when that is the only native chat API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [{ id: "anthropic/claude-sonnet", native_endpoints: ["/v1/messages"] }],
        }),
      ),
    );

    const [model] = await fetchCatalog(context, endpoint);
    expect(model).toMatchObject({
      api: "anthropic-messages",
      baseUrl: "http://100.65.0.3:3425",
    });
  });

  test("uses gemini when generateContent is the only native endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [{ id: "google/gemini-3", native_endpoints: ["/v1beta/models/gemini-3:generateContent"] }],
        }),
      ),
    );

    const [model] = await fetchCatalog(context, endpoint);
    expect(model).toMatchObject({
      api: "google-generative-ai",
      baseUrl: "http://100.65.0.3:3425/v1beta",
    });
  });

  test("converts OpenRouter per-token pricing to per-million rates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            {
              id: "deepseek/deepseek-v4-pro",
              display_name: "DeepSeek V4 Pro",
              pricing: {
                prompt: "0.0000003",
                completion: "0.0000012",
                input_cache_read: "0.00000003",
              },
            },
          ],
        }),
      ),
    );

    const [model] = await fetchCatalog(context, endpoint);
    expect(model?.cost).toEqual({ input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0 });
  });

  test("sends vendor effort aliases under the vendor's name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            {
              id: "trae/model",
              reasoning_levels: ["light", "high", "extra_high", "none"],
            },
          ],
        }),
      ),
    );

    const [model] = await fetchCatalog(context, endpoint);
    if (!model || model.type === "classifier" || model.type === "image") throw new Error("Expected a chat model");
    expect(model.thinkingLevelMap).toEqual({
      off: "none",
      minimal: null,
      low: "light",
      medium: null,
      high: "high",
      xhigh: "extra_high",
      max: null,
    });
  });

  test("leaves the thinking map unset when magpie lists no levels", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [{ id: "kimi/kimi-k3", reasoning: true, reasoning_levels: [] }],
        }),
      ),
    );

    const [model] = await fetchCatalog(context, endpoint);
    expect(model).toMatchObject({ reasoning: true, input: ["text"], contextWindow: 200000, maxTokens: 16384 });
    expect(model).not.toHaveProperty("thinkingLevelMap");
  });

  test("sends the fixed key even when a credential is stored", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetch);

    await fetchCatalog(
      {
        ...context,
        credential: { type: "api_key", key: "from-store" },
      },
      endpoint,
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ headers: { authorization: "Bearer magpie-private" } });
  });
});

describe("classifierModelConfigs", () => {
  test("registers configured decision models on System One and drops blanks and duplicates", () => {
    const rows = classifierModelConfigs(endpoint, [" jev-latest", "group/jevs", "jev-latest", "  "]);
    expect(rows).toEqual([
      {
        type: "classifier",
        id: "jev-latest",
        name: "jev-latest",
        api: "typesafe-system-one",
        baseUrl: "http://100.65.0.3:3425/v1",
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32_768,
      },
      {
        type: "classifier",
        id: "group/jevs",
        name: "group/jevs",
        api: "typesafe-system-one",
        baseUrl: "http://100.65.0.3:3425/v1",
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32_768,
      },
    ]);
  });
});
