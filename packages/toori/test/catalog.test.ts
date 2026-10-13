import {
  getSupportedThinkingLevels,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type RefreshModelsContext,
} from "@earendil-works/pi-ai";
import * as systemOne from "@earendil-works/pi-ai/api/typesafe-system-one";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchCatalog } from "../src/catalog.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchCatalog", () => {
  test("dispatches a gateway classifier through Pi's System One transport", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ data: [{ id: "jev-latest", supported_formats: ["typesafe-systemone"] }] }))
      .mockResolvedValueOnce(
        Response.json({
          model: "jev-latest",
          answers: {
            model: {
              type: "choice",
              choice: "middle",
              probabilities: { flash: 0.1, middle: 0.8, flagship: 0.1 },
              confidence: 0.8,
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const models = await fetchCatalog({
      allowNetwork: true,
      publish: async () => true,
      signal: new AbortController().signal,
    });
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsStore: new InMemoryModelsStore(),
      modelsPath: null,
      refreshOnCreate: false,
    });
    runtime.registerProvider("test-gateway", {
      baseUrl: "https://gateway.invalid/api/v1",
      apiKey: "test-key",
      api: "openai-completions",
      classifiers: { "typesafe-system-one": systemOne },
      models,
    });
    const model = runtime.getModelOfType("classifier", "test-gateway", "jev-latest");
    if (!model) throw new Error("Missing classifier");
    const result = await runtime.classify(
      model,
      {
        state: { task: "Implement" },
        questions: {
          model: {
            type: "choice",
            instructions: "Choose a tier",
            criteria: { flash: "Simple", middle: "Ordinary", flagship: "Complex" },
          },
        },
      },
      { maxRetries: 0 },
    );
    expect(result, result.errorMessage).toMatchObject({ stopReason: "stop", answers: { model: { choice: "middle" } } });
    expect(fetch.mock.calls[1][0].toString()).toBe("https://gateway.invalid/api/v1/systemone");
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: "POST", body: expect.stringContaining('"type":"choice"') });
    expect(runtime.getModel("test-gateway", "jev-latest")).toBeUndefined();
  });

  test("maps gateway supports_developer_role into compat", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            {
              id: "glm-5.3",
              supported_formats: ["openai-completions"],
              capabilities: { supports_developer_role: false },
            },
            {
              id: "group:cn-models",
              supported_formats: ["openai-completions"],
              capabilities: { supports_developer_role: false },
            },
            {
              id: "gpt-5.6-sol",
              supported_formats: ["openai-responses"],
              capabilities: { supports_reasoning: true },
            },
          ],
        }),
      ),
    );

    const models = await fetchCatalog({
      allowNetwork: true,
      publish: async () => true,
      signal: new AbortController().signal,
    });
    const byId = new Map(models.map((m) => [m.id, m]));

    expect(byId.get("glm-5.3")?.compat).toMatchObject({ supportsDeveloperRole: false, thinkingFormat: "zai" });
    expect(byId.get("group:cn-models")?.compat).toMatchObject({ supportsDeveloperRole: false });
    expect(byId.get("gpt-5.6-sol")?.compat).toMatchObject({ supportsDeveloperRole: true });
  });

  test("derives group model thinking levels from available_thinking_levels", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            {
              id: "group:cn-models",
              supported_formats: ["openai-completions"],
              capabilities: { supports_developer_role: false, available_thinking_levels: ["high", "max"] },
            },
          ],
        }),
      ),
    );

    const [model] = await fetchCatalog({
      allowNetwork: true,
      publish: async () => true,
      signal: new AbortController().signal,
    });
    if (model.type === "classifier" || model.type === "image") throw new Error("Expected a chat model");

    expect(model.thinkingLevelMap).toEqual({
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: null,
      max: "max",
    });
    expect(getSupportedThinkingLevels(model)).toEqual(["off", "high", "max"]);
  });

  test("exposes all supported GPT-5.6 thinking levels", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            {
              id: "gpt-5.6-sol",
              supported_formats: ["openai-responses"],
              capabilities: { supports_reasoning: true },
            },
          ],
        }),
      ),
    );

    const context: RefreshModelsContext = {
      allowNetwork: true,
      publish: async () => true,
      signal: new AbortController().signal,
    };
    const [model] = await fetchCatalog(context);
    if (model.type === "classifier" || model.type === "image") throw new Error("Expected a chat model");

    expect(model.thinkingLevelMap).toEqual({
      off: "none",
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    });
  });

  test.each(["typesafe-systemone", "typesafe-system-one"])(
    "registers %s models as native classifiers",
    async (format) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            data: [
              {
                id: "jev-latest",
                supported_formats: [format],
                context_window: 128000,
                cost: [{ input: 0.1, output: 0.2 }],
              },
            ],
          }),
        ),
      );
      const [model] = await fetchCatalog({
        allowNetwork: true,
        publish: async () => true,
        signal: new AbortController().signal,
      });
      expect(model).toMatchObject({
        type: "classifier",
        api: "typesafe-system-one",
        id: "jev-latest",
        contextWindow: 128000,
        input: ["text"],
        cost: { input: 0.1, output: 0.2 },
      });
      expect(model).not.toHaveProperty("maxTokens");
      expect(model).not.toHaveProperty("thinkingLevelMap");
    },
  );
});
