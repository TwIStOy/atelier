import { describe, expect, it } from "vitest";
import {
  AGGREGATE_RULE_READY_EVENT,
  AGGREGATE_RULE_REGISTER_EVENT,
  type AggregateRule,
  aggregateRuleFor,
  registerAggregateRule,
  resetAggregateRulesForTest,
} from "../src/aggregate-rules.ts";

describe("aggregate rule registry", () => {
  it("ships built-in rules for the four read-only tools", () => {
    resetAggregateRulesForTest();
    expect(aggregateRuleFor("read")).toEqual({
      verb: "Read",
      singular: "file",
      plural: "files",
      progressive: "Reading…",
    });
    expect(aggregateRuleFor("grep")).toEqual({
      verb: "Searched",
      singular: "pattern",
      plural: "patterns",
      progressive: "Searching…",
    });
    expect(aggregateRuleFor("glob")).toBeDefined();
    expect(aggregateRuleFor("ls")).toBeDefined();
  });

  it("looks up only registered names", () => {
    resetAggregateRulesForTest();
    expect(aggregateRuleFor("bash")).toBeUndefined();
    expect(aggregateRuleFor("glob")).toBeDefined();
  });

  it("registers a custom rule", () => {
    resetAggregateRulesForTest();
    const rule: AggregateRule = { verb: "Fetched", singular: "page", plural: "pages", progressive: "Fetching…" };
    expect(registerAggregateRule("web_fetch", rule)).toBe(true);
    expect(aggregateRuleFor("web_fetch")).toEqual(rule);
  });

  it("rejects a conflicting re-registration and keeps the first rule", () => {
    resetAggregateRulesForTest();
    expect(registerAggregateRule("read", { verb: "X", singular: "y", plural: "ys", progressive: "Z…" })).toBe(false);
    expect(aggregateRuleFor("read")?.verb).toBe("Read");
  });

  it("accepts an identical re-registration (idempotent for reloads)", () => {
    resetAggregateRulesForTest();
    expect(
      registerAggregateRule("read", { verb: "Read", singular: "file", plural: "files", progressive: "Reading…" }),
    ).toBe(true);
  });

  it("exposes the event names for the cross-extension channel", () => {
    expect(AGGREGATE_RULE_REGISTER_EVENT).toBe("tool-display:register-aggregate-rule");
    expect(AGGREGATE_RULE_READY_EVENT).toBe("tool-display:aggregate-rules-ready");
  });
});
