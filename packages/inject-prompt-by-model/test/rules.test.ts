import { describe, expect, it } from "vitest";
import {
  applyModelPromptRules,
  type ModelPromptRule,
  modelTarget,
  replaceSystemPromptFirstLine,
  resolveModelPrompts,
} from "../src/resolve.ts";
import { DEEPSEEK_V4_FIRST_LINE } from "../src/rules/deepseek-v4.ts";
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
    expect(MODEL_PROMPT_RULES.map((rule) => rule.name)).toEqual(["kimi-k3", "deepseek-v4"]);
    const matched = resolveModelPrompts("moonshot/kimi-k3");
    expect(matched.map((rule) => rule.name)).toEqual(["kimi-k3"]);
    expect(matched[0]?.prompt).toContain("edit");
  });

  it("matches deepseek-v4 flash and pro, not other deepseek ids", () => {
    expect(resolveModelPrompts("inference-v2-self-host/deepseek-v4-flash").map((rule) => rule.name)).toEqual([
      "deepseek-v4",
    ]);
    expect(resolveModelPrompts("inference-self-host/deepseek-v4-pro").map((rule) => rule.name)).toEqual([
      "deepseek-v4",
    ]);
    expect(resolveModelPrompts("inference-self-host/deepseek-v3")).toEqual([]);
  });
});

describe("replaceSystemPromptFirstLine", () => {
  it("replaces only the first line and keeps the rest", () => {
    expect(replaceSystemPromptFirstLine("OLD\nrest\nmore", "NEW")).toBe("NEW\nrest\nmore");
  });

  it("replaces a single-line prompt entirely", () => {
    expect(replaceSystemPromptFirstLine("OLD", "NEW")).toBe("NEW");
  });
});

describe("applyModelPromptRules", () => {
  const base = "You are an expert coding assistant operating inside pi.\n\nAvailable tools:";

  it("returns null when no rules match", () => {
    expect(applyModelPromptRules(base, [])).toBeNull();
  });

  it("appends prompt-only rules", () => {
    const rules: ModelPromptRule[] = [{ name: "a", pattern: /.*/, prompt: "TAIL" }];
    expect(applyModelPromptRules(base, rules)).toBe(`${base}\n\nTAIL`);
  });

  it("rewrites the first line for replaceFirstLine rules", () => {
    const rules: ModelPromptRule[] = [{ name: "a", pattern: /.*/, replaceFirstLine: DEEPSEEK_V4_FIRST_LINE }];
    expect(applyModelPromptRules(base, rules)).toBe(`${DEEPSEEK_V4_FIRST_LINE}\n\nAvailable tools:`);
  });

  it("rewrites the first line then appends when both are present", () => {
    const rules: ModelPromptRule[] = [
      { name: "line", pattern: /.*/, replaceFirstLine: "NEW" },
      { name: "tail", pattern: /.*/, prompt: "TAIL" },
    ];
    expect(applyModelPromptRules(base, rules)).toBe("NEW\n\nAvailable tools:\n\nTAIL");
  });
});
