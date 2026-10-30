import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import { buildContextUsageDetails } from "../src/context-usage.ts";

test("context details use Pi's usage limits and the current session model", () => {
  const model: Model<Api> = {
    provider: "test",
    id: "middle",
    name: "Middle",
    api: "test",
    baseUrl: "",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 400_000,
    maxTokens: 8192,
  };
  const ctx = {
    model,
    getContextUsage: () => ({ tokens: 100_000, contextWindow: 200_000, percent: 50 }),
    getSystemPrompt: () => "",
    sessionManager: { getBranch: () => [] },
  } as unknown as ExtensionContext;
  const details = buildContextUsageDetails({ getThinkingLevel: () => "max" } as ExtensionAPI, ctx, undefined);
  expect(details?.usage).toEqual({ tokens: 100_000, contextWindow: 200_000, percent: 50 });
  expect(details?.freeTokens).toBe(100_000);
  expect(details?.model).toMatchObject({
    provider: "test",
    id: "middle",
    thinking: "max",
    label: "Middle",
  });
});
