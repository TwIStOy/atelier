import { aggregateRuleFor, isExtensionDisabled, resetAggregateRulesForTest } from "@htwang-contrib/common";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@htwang-contrib/common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@htwang-contrib/common")>();
  return {
    ...actual,
    isExtensionDisabled: vi.fn(() => false),
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import initWebTools from "../src/index.ts";

function mockPi(): ExtensionAPI {
  return {
    registerTool: vi.fn(),
    on: vi.fn(),
  } as unknown as ExtensionAPI;
}

afterEach(() => {
  resetAggregateRulesForTest();
  vi.mocked(isExtensionDisabled).mockReturnValue(false);
});

describe("web-tools aggregate rules", () => {
  it("registers web_fetch and web_search rules when the extension loads", () => {
    initWebTools(mockPi());

    expect(aggregateRuleFor("web_fetch")).toEqual({
      verb: "Fetched",
      singular: "page",
      plural: "pages",
      progressive: "Fetching…",
    });
    expect(aggregateRuleFor("web_search")).toEqual({
      verb: "Searched",
      singular: "query",
      plural: "queries",
      progressive: "Searching…",
    });
  });

  it("does not register rules when the extension is disabled", () => {
    vi.mocked(isExtensionDisabled).mockReturnValue(true);

    initWebTools(mockPi());

    expect(aggregateRuleFor("web_fetch")).toBeUndefined();
    expect(aggregateRuleFor("web_search")).toBeUndefined();
  });

  it("is idempotent across re-entry", () => {
    initWebTools(mockPi());
    expect(() => initWebTools(mockPi())).not.toThrow();
    expect(aggregateRuleFor("web_fetch")).toBeDefined();
  });

  it("resetAggregateRulesForTest drops web-tools rules", () => {
    initWebTools(mockPi());
    resetAggregateRulesForTest();
    expect(aggregateRuleFor("web_fetch")).toBeUndefined();
    expect(aggregateRuleFor("read")).toBeDefined();
  });
});
