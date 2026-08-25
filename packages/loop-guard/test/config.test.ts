import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import { DEFAULT_CONFIG, type LoopGuardConfig, loadConfig, parseAllowedTools } from "../src/config.ts";

let mockConfig: LoopGuardConfig;

vi.mock("@htwang-contrib/common", () => ({
  registerConfigItems: () => {},
  readConfig: () => mockConfig,
}));

describe("loop-guard config", () => {
  beforeEach(() => {
    mockConfig = { ...DEFAULT_CONFIG };
  });

  it("defaults to allowing subagent_status", () => {
    assert.equal(loadConfig().allowedTools, "subagent_status");
    assert.deepEqual(parseAllowedTools(DEFAULT_CONFIG.allowedTools), new Set(["subagent_status"]));
  });

  it("parses comma-separated names with whitespace", () => {
    assert.deepEqual(parseAllowedTools(" subagent_status , todo_list ,,  "), new Set(["subagent_status", "todo_list"]));
  });

  it("returns an empty set for an empty string", () => {
    assert.deepEqual(parseAllowedTools("   "), new Set());
  });

  it("normalizes an array value from extensions.json into a comma-separated string", () => {
    mockConfig = { ...DEFAULT_CONFIG, allowedTools: ["subagent_status", "todo_get"] as unknown as string };
    assert.equal(loadConfig().allowedTools, "subagent_status,todo_get");
  });
});
