import { aggregateRuleFor, resetAggregateRulesForTest } from "@htwang-contrib/common/aggregate-rules";
import { isExtensionDisabled } from "@htwang-contrib/common/extension-disable";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@htwang-contrib/common/extension-disable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@htwang-contrib/common/extension-disable")>();
  return {
    ...actual,
    isExtensionDisabled: vi.fn(() => false),
  };
});

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import initMemory from "../src/index.ts";

function mockPi(): ExtensionAPI {
  return {
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
    on: vi.fn(),
  } as unknown as ExtensionAPI;
}

afterEach(() => {
  resetAggregateRulesForTest();
  vi.mocked(isExtensionDisabled).mockReturnValue(false);
});

describe("memory aggregate rules", () => {
  it("registers memory and journal rules when the extension loads", () => {
    initMemory(mockPi());

    expect(aggregateRuleFor("memory-read")).toEqual({
      verb: "Read",
      singular: "memory",
      plural: "memories",
      progressive: "Reading…",
    });
    expect(aggregateRuleFor("memory-search")).toEqual({
      verb: "Searched",
      singular: "memory",
      plural: "memories",
      progressive: "Searching…",
    });
    expect(aggregateRuleFor("memory-list")).toEqual({
      verb: "Listed",
      singular: "memory tree",
      plural: "memory trees",
      progressive: "Listing…",
    });
    expect(aggregateRuleFor("memory-history")).toEqual({
      verb: "Read",
      singular: "memory history",
      plural: "memory histories",
      progressive: "Reading…",
    });
    expect(aggregateRuleFor("memory-domains")).toEqual({
      verb: "Listed",
      singular: "domain",
      plural: "domains",
      progressive: "Listing…",
    });
    expect(aggregateRuleFor("journal-read")).toEqual({
      verb: "Read",
      singular: "journal entry",
      plural: "journal entries",
      progressive: "Reading…",
    });
    expect(aggregateRuleFor("journal-search")).toEqual({
      verb: "Searched",
      singular: "journal entry",
      plural: "journal entries",
      progressive: "Searching…",
    });
  });

  it("does not register rules when the extension is disabled", () => {
    vi.mocked(isExtensionDisabled).mockReturnValue(true);

    initMemory(mockPi());

    expect(aggregateRuleFor("memory-read")).toBeUndefined();
    expect(aggregateRuleFor("memory-search")).toBeUndefined();
    expect(aggregateRuleFor("journal-read")).toBeUndefined();
  });

  it("is idempotent across re-entry", () => {
    initMemory(mockPi());
    expect(() => initMemory(mockPi())).not.toThrow();
    expect(aggregateRuleFor("memory-read")).toBeDefined();
  });

  it("resetAggregateRulesForTest drops memory rules", () => {
    initMemory(mockPi());
    resetAggregateRulesForTest();
    expect(aggregateRuleFor("memory-read")).toBeUndefined();
    expect(aggregateRuleFor("read")).toBeDefined();
  });
});
