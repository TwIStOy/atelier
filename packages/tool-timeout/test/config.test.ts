import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import {
  DEFAULT_CONFIG,
  loadConfig,
  matchesExemptRule,
  normalizeExemptRules,
  resolveBashTimeoutSeconds,
  type ToolTimeoutConfig,
} from "../src/config.ts";

let mockConfig: ToolTimeoutConfig;

vi.mock("@htwang-contrib/common", () => ({
  registerConfigItems: () => {},
  readConfig: () => mockConfig,
}));

describe("tool-timeout config", () => {
  beforeEach(() => {
    mockConfig = { maxTimeoutSeconds: DEFAULT_CONFIG.maxTimeoutSeconds, exemptRules: [] };
  });

  it("defaults to a one-hour cap", () => {
    assert.equal(loadConfig().maxTimeoutSeconds, 3600);
  });

  it("falls back to the default on non-numeric values", () => {
    for (const bad of ["3600", null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      mockConfig = { exemptRules: [], maxTimeoutSeconds: bad as unknown as number };
      assert.equal(loadConfig().maxTimeoutSeconds, 3600, `value: ${String(bad)}`);
    }
  });

  it("clamps negative values to zero (disabled)", () => {
    mockConfig = { exemptRules: [], maxTimeoutSeconds: -5 };
    assert.equal(loadConfig().maxTimeoutSeconds, 0);
  });

  it("defaults to no exempt rules", () => {
    assert.deepEqual(loadConfig().exemptRules, []);
  });

  it("keeps parsed exempt rules", () => {
    const rules = [{ tool: "bash", pattern: "ocr review" }];
    mockConfig = { maxTimeoutSeconds: 3600, exemptRules: rules };
    assert.deepEqual(loadConfig().exemptRules, rules);
  });
});

describe("normalizeExemptRules", () => {
  it("accepts tool/pattern objects and trims whitespace", () => {
    assert.deepEqual(
      normalizeExemptRules([
        { tool: " bash ", pattern: " ocr review " },
        { tool: "mytool", pattern: "watch --all" },
      ]),
      [
        { tool: "bash", pattern: "ocr review" },
        { tool: "mytool", pattern: "watch --all" },
      ],
    );
  });

  it("returns no rules for non-array values", () => {
    for (const bad of [undefined, null, "bash=ocr review", 3600, {}]) {
      assert.deepEqual(normalizeExemptRules(bad), [], `value: ${String(bad)}`);
    }
  });

  it("drops malformed entries", () => {
    assert.deepEqual(
      normalizeExemptRules([
        { tool: "bash", pattern: "sleep 5" },
        "bash=ocr review",
        null,
        42,
        {},
        { tool: "bash" },
        { pattern: "ocr review" },
        { tool: "", pattern: "ocr review" },
        { tool: "bash", pattern: "  " },
        { tool: 7, pattern: "ocr review" },
        { tool: "bash", pattern: 7 },
      ]),
      [{ tool: "bash", pattern: "sleep 5" }],
    );
  });

  it("keeps patterns containing separators and special characters", () => {
    assert.deepEqual(normalizeExemptRules([{ tool: "bash", pattern: "FOO=bar, ocr review" }]), [
      { tool: "bash", pattern: "FOO=bar, ocr review" },
    ]);
  });
});

describe("matchesExemptRule", () => {
  it("matches when the tool name and a string argument containing the pattern line up", () => {
    const rules = normalizeExemptRules([{ tool: "bash", pattern: "ocr review" }]);
    assert.equal(matchesExemptRule(rules, "bash", { command: "ocr review --all" }), true);
    assert.equal(matchesExemptRule(rules, "bash", { command: "echo running ocr review now" }), true);
  });

  it("does not match a different tool name", () => {
    const rules = normalizeExemptRules([{ tool: "bash", pattern: "ocr review" }]);
    assert.equal(matchesExemptRule(rules, "read", { command: "ocr review" }), false);
  });

  it("does not match when no string argument contains the pattern", () => {
    const rules = normalizeExemptRules([{ tool: "bash", pattern: "ocr review" }]);
    assert.equal(matchesExemptRule(rules, "bash", { command: "sleep 1000" }), false);
    assert.equal(matchesExemptRule(rules, "bash", {}), false);
  });

  it("ignores non-string argument values", () => {
    const rules = normalizeExemptRules([{ tool: "bash", pattern: "300" }]);
    assert.equal(matchesExemptRule(rules, "bash", { command: "sleep 999", timeout: 300 }), false);
  });

  it("matches against any string argument, not just command", () => {
    const rules = normalizeExemptRules([{ tool: "mytool", pattern: "watch" }]);
    assert.equal(matchesExemptRule(rules, "mytool", { action: "run", mode: "watch --all" }), true);
  });
});

describe("resolveBashTimeoutSeconds", () => {
  const max = 3600;

  it("applies the cap when no timeout was requested", () => {
    assert.equal(resolveBashTimeoutSeconds(undefined, max), 3600);
  });

  it("keeps a requested timeout at or below the cap", () => {
    assert.equal(resolveBashTimeoutSeconds(30, max), 30);
    assert.equal(resolveBashTimeoutSeconds(3600, max), 3600);
    assert.equal(resolveBashTimeoutSeconds(0.5, max), 0.5);
  });

  it("clamps a requested timeout above the cap", () => {
    assert.equal(resolveBashTimeoutSeconds(86400, max), 3600);
  });

  it("replaces invalid requested values with the cap", () => {
    for (const bad of [0, -30, Number.NaN, Number.POSITIVE_INFINITY, "120", null]) {
      assert.equal(resolveBashTimeoutSeconds(bad, max), 3600, `value: ${String(bad)}`);
    }
  });
});
