import * as assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import {
  buildReplacementMessage,
  buildTempFilePath,
  countLines,
  DEFAULT_CONFIG,
  shouldTruncate,
  type TruncateConfig,
} from "../src/truncate-output.ts";

const baseConfig: TruncateConfig = { ...DEFAULT_CONFIG, dir: "/tmp" };

describe("shouldTruncate", () => {
  it("does not truncate when disabled", () => {
    const decision = shouldTruncate("web_search", 100_000, { ...baseConfig, enabled: false });
    assert.equal(decision.truncate, false);
    assert.equal(decision.reason, "disabled");
  });

  it("does not truncate denylisted tools regardless of size", () => {
    const decision = shouldTruncate("read", 100_000, baseConfig);
    assert.equal(decision.truncate, false);
    assert.equal(decision.reason, "denied");
  });

  it("does not truncate output at or below the threshold", () => {
    assert.equal(shouldTruncate("web_search", baseConfig.threshold, baseConfig).truncate, false);
    assert.equal(shouldTruncate("web_search", baseConfig.threshold - 1, baseConfig).truncate, false);
  });

  it("truncates oversized output from a non-denylisted tool", () => {
    const decision = shouldTruncate("web_search", baseConfig.threshold + 1, baseConfig);
    assert.equal(decision.truncate, true);
    assert.equal(decision.reason, undefined);
  });

  it("respects a custom denylist", () => {
    const cfg = { ...baseConfig, toolDenylist: ["custom_tool"] };
    assert.equal(shouldTruncate("custom_tool", 1_000_000, cfg).truncate, false);
    assert.equal(shouldTruncate("read", 1_000_000, cfg).truncate, true);
  });
});

describe("buildTempFilePath", () => {
  it("places the file under the configured dir and is unique per call id", () => {
    const a = buildTempFilePath("web_search", "call-123", baseConfig);
    const b = buildTempFilePath("web_search", "call-456", baseConfig);
    assert.ok(a.startsWith("/tmp/pi-web_search-"));
    assert.ok(a.endsWith(".txt"));
    assert.notEqual(a, b);
  });

  it("sanitizes unusual tool names", () => {
    const path = buildTempFilePath("weird/tool name!", "call-1", baseConfig);
    assert.ok(path.startsWith("/tmp/pi-weird-tool-name-"), `got: ${path}`);
    assert.ok(!path.includes("!"));
  });
});

describe("buildReplacementMessage", () => {
  it("includes size, threshold, saved path, and tool hints", () => {
    const savedPath = "/tmp/pi-web_search-call-1.txt";
    const msg = buildReplacementMessage(
      { toolName: "web_search", text: "x".repeat(40_000) },
      40_000,
      1,
      savedPath,
      baseConfig,
    );
    assert.ok(msg.includes('"web_search"'));
    assert.ok(msg.includes("40,000 bytes"));
    assert.ok(msg.includes(`exceeding the ${baseConfig.threshold.toLocaleString("en-US")}-byte limit`));
    assert.ok(msg.includes(savedPath));
    assert.ok(msg.includes("ranged read"));
    assert.ok(msg.includes("rg"));
  });
});

describe("countLines", () => {
  it("counts empty input as zero lines", () => {
    assert.equal(countLines(""), 0);
  });

  it("counts a trailing newline as expected", () => {
    assert.equal(countLines("a\nb\n"), 2);
    assert.equal(countLines("a\nb"), 2);
  });

  it("counts a single line without newline as one", () => {
    assert.equal(countLines("hello"), 1);
  });
});

describe("integration: oversized output flow", () => {
  it("end-to-end decision -> path -> message matches the saved file", () => {
    const toolName = "search_files";
    const text = "x".repeat(baseConfig.threshold + 100);
    const bytes = Buffer.byteLength(text, "utf8");
    const decision = shouldTruncate(toolName, bytes, baseConfig);
    expect(decision.truncate).toBe(true);
    const savedPath = buildTempFilePath(toolName, "call-abc", baseConfig);
    const msg = buildReplacementMessage({ toolName, text }, bytes, countLines(text), savedPath, baseConfig);
    assert.ok(msg.includes(savedPath));
  });
});
