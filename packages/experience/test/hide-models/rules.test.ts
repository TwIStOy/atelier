import * as assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  addRule,
  buildRuleSet,
  canonicalRule,
  describeRule,
  isModelHidden,
  parseCanonical,
  parseTarget,
  removeRule,
} from "../../src/hide-models/rules.ts";

describe("parseTarget", () => {
  it("parses a bare provider as whole-provider", () => {
    assert.deepEqual(parseTarget("ollama"), { provider: "ollama", model: null });
  });

  it("lowercases the provider", () => {
    assert.deepEqual(parseTarget("OpenRouter"), { provider: "openrouter", model: null });
  });

  it("parses provider/* as whole-provider", () => {
    assert.deepEqual(parseTarget("openrouter/*"), { provider: "openrouter", model: null });
  });

  it("parses provider/ as whole-provider", () => {
    assert.deepEqual(parseTarget("openrouter/"), { provider: "openrouter", model: null });
  });

  it("parses a specific model keeping the id verbatim", () => {
    assert.deepEqual(parseTarget("openrouter/Cheap-Model"), { provider: "openrouter", model: "Cheap-Model" });
  });

  it("parses a model id containing slashes", () => {
    assert.deepEqual(parseTarget("openrouter/claude/sonnet"), { provider: "openrouter", model: "claude/sonnet" });
  });

  it("returns null for empty input", () => {
    assert.equal(parseTarget(""), null);
    assert.equal(parseTarget("   "), null);
  });

  it("returns null when provider is empty", () => {
    assert.equal(parseTarget("/model"), null);
    assert.equal(parseTarget(" /model"), null);
  });
});

describe("canonicalRule", () => {
  it("uses bare provider for whole-provider targets", () => {
    assert.equal(canonicalRule({ provider: "ollama", model: null }), "ollama");
  });

  it("joins provider and model for specific targets", () => {
    assert.equal(canonicalRule({ provider: "ollama", model: "llama3" }), "ollama/llama3");
  });
});

describe("parseCanonical", () => {
  it("normalizes provider/* to bare provider", () => {
    assert.equal(parseCanonical("openrouter/*"), "openrouter");
  });

  it("returns null for invalid input", () => {
    assert.equal(parseCanonical(""), null);
    assert.equal(parseCanonical("/x"), null);
  });
});

describe("addRule / removeRule", () => {
  it("adds a new canonical rule", () => {
    assert.deepEqual(addRule(["ollama"], "openrouter/cheap"), ["ollama", "openrouter/cheap"]);
  });

  it("does not duplicate an existing rule", () => {
    assert.deepEqual(addRule(["ollama", "openrouter/cheap"], "ollama"), ["ollama", "openrouter/cheap"]);
  });

  it("removes a rule by canonical value", () => {
    assert.deepEqual(removeRule(["ollama", "openrouter/cheap"], "ollama"), ["openrouter/cheap"]);
  });

  it("remove is a no-op for missing rule", () => {
    assert.deepEqual(removeRule(["ollama"], "openrouter/cheap"), ["ollama"]);
  });
});

describe("buildRuleSet + isModelHidden", () => {
  it("hides every model of a whole-provider rule", () => {
    const rs = buildRuleSet(["ollama"]);
    assert.equal(isModelHidden("ollama", "llama3", rs), true);
    assert.equal(isModelHidden("ollama", "mistral", rs), true);
    assert.equal(isModelHidden("openrouter", "x", rs), false);
  });

  it("hides only the specific model for provider/model rules", () => {
    const rs = buildRuleSet(["openrouter/cheap-model"]);
    assert.equal(isModelHidden("openrouter", "cheap-model", rs), true);
    assert.equal(isModelHidden("openrouter", "expensive-model", rs), false);
  });

  it("combines whole-provider and specific rules", () => {
    const rs = buildRuleSet(["ollama", "openrouter/cheap-model"]);
    assert.equal(isModelHidden("Ollama", "anything", rs), true);
    assert.equal(isModelHidden("OpenRouter", "cheap-model", rs), true);
    assert.equal(isModelHidden("openrouter", "other", rs), false);
  });

  it("treats provider/* and provider equivalently", () => {
    const rs = buildRuleSet(["ollama/*"]);
    assert.equal(isModelHidden("ollama", "llama3", rs), true);
  });

  it("matches model ids case-sensitively", () => {
    const rs = buildRuleSet(["openrouter/Cheap-Model"]);
    assert.equal(isModelHidden("openrouter", "Cheap-Model", rs), true);
    assert.equal(isModelHidden("openrouter", "cheap-model", rs), false);
  });

  it("returns empty rule set for empty input", () => {
    const rs = buildRuleSet([]);
    assert.equal(isModelHidden("ollama", "x", rs), false);
  });

  it("skips unparseable rules", () => {
    const rs = buildRuleSet(["", "/x", "ollama"]);
    assert.equal(isModelHidden("ollama", "x", rs), true);
  });
});

describe("describeRule", () => {
  it("describes a whole-provider rule", () => {
    assert.equal(describeRule("ollama"), "ollama (whole provider)");
  });

  it("describes a specific-model rule", () => {
    assert.equal(describeRule("openrouter/cheap-model"), "openrouter/cheap-model");
  });
});
