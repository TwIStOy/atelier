import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import { DEFAULT_CONFIG, loadConfig, resolveBashTimeoutSeconds, type ToolTimeoutConfig } from "../src/config.ts";

let mockConfig: ToolTimeoutConfig;

vi.mock("@htwang-contrib/common", () => ({
  registerConfigItems: () => {},
  readConfig: () => mockConfig,
}));

describe("tool-timeout config", () => {
  beforeEach(() => {
    mockConfig = { ...DEFAULT_CONFIG };
  });

  it("defaults to a one-hour cap", () => {
    assert.equal(loadConfig().maxTimeoutSeconds, 3600);
  });

  it("falls back to the default on non-numeric values", () => {
    for (const bad of ["3600", null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      mockConfig = { maxTimeoutSeconds: bad as unknown as number };
      assert.equal(loadConfig().maxTimeoutSeconds, 3600, `value: ${String(bad)}`);
    }
  });

  it("clamps negative values to zero (disabled)", () => {
    mockConfig = { maxTimeoutSeconds: -5 };
    assert.equal(loadConfig().maxTimeoutSeconds, 0);
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
