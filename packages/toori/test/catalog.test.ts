import type { RefreshModelsContext } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchCatalog } from "../src/catalog.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchCatalog", () => {
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
});
