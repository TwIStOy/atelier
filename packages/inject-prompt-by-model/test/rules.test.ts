import { describe, expect, it } from "vitest";
import { MODEL_PROMPT_RULES, type ModelPromptRule, modelTarget, resolveModelPrompt } from "../src/rules.ts";

describe("modelTarget", () => {
  it("joins provider and id with a slash", () => {
    expect(modelTarget({ provider: "zai", id: "glm-4.7" })).toBe("zai/glm-4.7");
  });
});

describe("resolveModelPrompt", () => {
  const rules: ModelPromptRule[] = [
    { name: "glm", pattern: /^zai\/glm-/, prompt: "GLM prompt" },
    { name: "zai-any", pattern: /^zai\//, prompt: "ZAI prompt" },
  ];

  it("returns the first matching rule when several match", () => {
    expect(resolveModelPrompt("zai/glm-4.7", rules)?.name).toBe("glm");
  });

  it("falls through to a later rule when earlier ones miss", () => {
    expect(resolveModelPrompt("zai/coding-plan", rules)?.name).toBe("zai-any");
  });

  it("returns null when nothing matches", () => {
    expect(resolveModelPrompt("openai/gpt-5", rules)).toBeNull();
  });

  it("returns null for the empty built-in rule list", () => {
    expect(MODEL_PROMPT_RULES).toEqual([]);
    expect(resolveModelPrompt("zai/glm-4.7")).toBeNull();
  });
});
