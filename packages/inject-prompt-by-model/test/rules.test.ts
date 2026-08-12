import { describe, expect, it } from "vitest";
import { type ModelPromptRule, modelTarget, resolveModelPrompts } from "../src/resolve.ts";
import { MODEL_PROMPT_RULES } from "../src/rules/index.ts";

describe("modelTarget", () => {
  it("joins provider and id with a slash", () => {
    expect(modelTarget({ provider: "zai", id: "glm-4.7" })).toBe("zai/glm-4.7");
  });
});

describe("resolveModelPrompts", () => {
  const rules: ModelPromptRule[] = [
    { name: "glm", pattern: /^zai\/glm-/, prompt: "GLM prompt" },
    { name: "zai-any", pattern: /^zai\//, prompt: "ZAI prompt" },
  ];

  it("returns all matching rules in registration order", () => {
    expect(resolveModelPrompts("zai/glm-4.7", rules).map((rule) => rule.name)).toEqual(["glm", "zai-any"]);
  });

  it("returns only the matching subset", () => {
    expect(resolveModelPrompts("zai/coding-plan", rules).map((rule) => rule.name)).toEqual(["zai-any"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(resolveModelPrompts("openai/gpt-5", rules)).toEqual([]);
  });

  it("matches kimi-k3 models with the built-in rule list", () => {
    expect(MODEL_PROMPT_RULES.map((rule) => rule.name)).toEqual(["kimi-k3"]);
    const matched = resolveModelPrompts("moonshot/kimi-k3");
    expect(matched.map((rule) => rule.name)).toEqual(["kimi-k3"]);
    expect(matched[0]?.prompt).toContain("edit");
  });
});
