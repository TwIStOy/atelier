import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { setVirtualModelStatus } from "@htwang-contrib/common";
import { afterEach, expect, test } from "vitest";
import { buildContextUsageDetails } from "../src/context-usage.ts";

afterEach(() => setVirtualModelStatus("context-route", undefined));

test("context details report the active physical model instead of stale native limits", () => {
  const physicalModel: Model<Api> = {
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
    model: { ...physicalModel, api: "pi-virtual", provider: "virtual", id: "auto" },
    getContextUsage: () => ({ tokens: 100_000, contextWindow: 200_000, percent: 50 }),
    getSystemPrompt: () => "",
    sessionManager: { getSessionId: () => "context-route", getBranch: () => [] },
  } as unknown as ExtensionContext;
  setVirtualModelStatus("context-route", {
    provider: "virtual",
    modelId: "auto",
    tier: "middle",
    physicalModel,
    thinkingLevel: "high",
  });
  const details = buildContextUsageDetails({ getThinkingLevel: () => "max" } as ExtensionAPI, ctx, undefined);
  expect(details?.usage).toEqual({ tokens: 100_000, contextWindow: 400_000, percent: 25 });
  expect(details?.freeTokens).toBe(300_000);
  expect(details?.model).toMatchObject({
    provider: "test",
    id: "middle",
    thinking: "high",
    label: "Auto · middle → Middle",
  });
});
