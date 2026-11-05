import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import { buildContextUsageDetails, renderContextUsageMessage } from "../src/context-usage.ts";

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

test("context usage rendering caches unchanged lines and invalidates explicitly", () => {
  const fg = vi.fn((_color: string, text: string) => text);
  const theme = { fg, bold: (text: string) => text, italic: (text: string) => text } as unknown as Theme;
  const details = {
    usage: { contextWindow: 1000, percent: 10, tokens: 100 },
    model: { contextWindow: 1000, id: "model", label: "Model", provider: "test" },
    categories: [{ key: "messages", label: "Messages", rawTokens: 100, tokens: 100, color: "accent", icon: "◉" }],
    freeTokens: 900,
    contextFiles: [],
    skills: [],
    customAgents: [],
    builtinTools: [],
    extensionTools: [],
    mcpTools: [],
    messageStats: {
      assistant: 1,
      bash: 0,
      branchEntries: 2,
      compact: 0,
      contextMessages: 2,
      custom: 0,
      toolResult: 0,
      user: 1,
    },
    compactSummaries: [],
  };
  const renderer = renderContextUsageMessage({ details }, {}, theme);

  const wide = renderer.render(80);
  const wideCalls = fg.mock.calls.length;
  expect(renderer.render(80)).toBe(wide);
  expect(fg).toHaveBeenCalledTimes(wideCalls);

  const narrow = renderer.render(40);
  expect(narrow).not.toBe(wide);
  const narrowCalls = fg.mock.calls.length;
  expect(narrowCalls).toBeGreaterThan(wideCalls);
  expect(renderer.render(40)).toBe(narrow);
  expect(fg).toHaveBeenCalledTimes(narrowCalls);

  renderer.invalidate();
  expect(renderer.render(40)).not.toBe(narrow);
  expect(renderer.render(40)).toEqual(narrow);
});
