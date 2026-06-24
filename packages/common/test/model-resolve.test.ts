import { describe, expect, test } from "vitest";
import type { ResolvableModel } from "../src/model-resolve.ts";
import { resolveModel } from "../src/model-resolve.ts";

const MODELS: ResolvableModel[] = [
  { id: "glm-5.1", name: "GLM-5.1", provider: "inference-self-host" },
  { id: "glm-5", name: "GLM-5", provider: "inference-self-host" },
  { id: "glm-4.7", name: "GLM-4.7", provider: "inference-self-host" },
  { id: "glm-4.6", name: "GLM-4.6", provider: "inference-self-host" },
  { id: "glm-4.5-air", name: "GLM-4.5-Air", provider: "inference-self-host" },
  { id: "glm-4.5", name: "GLM-4.5", provider: "inference-self-host" },
  {
    id: "glm-5-turbo",
    name: "GLM-5-Turbo",
    provider: "inference-self-host",
  },
  { id: "mimo-v2.5", name: "MiMo-V2.5", provider: "inference-self-host" },
  {
    id: "mimo-v2.5-pro",
    name: "MiMo-V2.5-Pro",
    provider: "inference-self-host",
  },
  {
    id: "mimo-v2-pro",
    name: "MiMo-V2-Pro",
    provider: "inference-self-host",
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    provider: "inference-self-host",
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    provider: "inference-self-host",
  },
  { id: "kimi-k2.6", name: "Kimi-K2.6", provider: "inference-self-host" },
  { id: "kimi-k2.5", name: "Kimi-K2.5", provider: "inference-self-host" },
  {
    id: "qwen3.7-max",
    name: "Qwen3.7-Max",
    provider: "inference-self-host",
  },
  {
    id: "qwen3.6-plus",
    name: "Qwen3.6-Plus",
    provider: "inference-self-host",
  },
  {
    id: "qwen3.5-plus",
    name: "Qwen3.5-Plus",
    provider: "inference-self-host",
  },
  {
    id: "minimax-m2.7",
    name: "MiniMax-M2.7",
    provider: "inference-self-host",
  },
  {
    id: "minimax-m2.5",
    name: "MiniMax-M2.5",
    provider: "inference-self-host",
  },
  { id: "glm-5.1", name: "GLM-5.1", provider: "zai-coding-plan" },
  { id: "glm-5", name: "GLM-5", provider: "zai-coding-plan" },
  {
    id: "glm-5-turbo",
    name: "GLM-5-Turbo",
    provider: "zai-coding-plan",
  },
];

describe("resolveModel", () => {
  test("returns undefined for empty models", () => {
    expect(resolveModel([], "glm-5")).toBeUndefined();
  });

  test("returns undefined for empty pattern", () => {
    expect(resolveModel(MODELS, "")).toBeUndefined();
  });

  test("returns undefined when nothing matches", () => {
    expect(resolveModel(MODELS, "nonexistent")).toBeUndefined();
  });

  test("exact provider/model match", () => {
    const result = resolveModel(MODELS, "zai-coding-plan/glm-5.1");
    expect(result).toBeDefined();
    expect(result!.id).toBe("glm-5.1");
    expect(result!.provider).toBe("zai-coding-plan");
  });

  test("exact id match", () => {
    const result = resolveModel(MODELS, "deepseek-v4-flash");
    expect(result).toBeDefined();
    expect(result!.id).toBe("deepseek-v4-flash");
  });

  test("exact id match is case insensitive", () => {
    const result = resolveModel(MODELS, "GLM-5.1");
    expect(result).toBeDefined();
    expect(result!.id).toBe("glm-5.1");
  });

  test("exact provider/model beats exact id", () => {
    const result = resolveModel(MODELS, "inference-self-host/glm-5.1");
    expect(result).toBeDefined();
    expect(result!.provider).toBe("inference-self-host");
  });

  test("id contains match prefers shorter target (higher ratio)", () => {
    const result = resolveModel(MODELS, "deepseek-v4");
    expect(result).toBeDefined();
    expect(result!.id).toBe("deepseek-v4-pro");
  });

  test("version tiebreaker: higher minor on same score", () => {
    const result = resolveModel(MODELS, "minimax-m2");
    expect(result).toBeDefined();
    expect(result!.id).toBe("minimax-m2.7");
  });

  test("name contains match", () => {
    const result = resolveModel(MODELS, "MiniMax");
    expect(result).toBeDefined();
    expect(result!.provider).toBe("inference-self-host");
  });

  test("provider/id contains match", () => {
    const result = resolveModel(MODELS, "inference-self-host/deepseek");
    expect(result).toBeDefined();
    expect(result!.provider).toBe("inference-self-host");
    expect(result!.id).toContain("deepseek");
  });
});

describe("resolveModel signal tiers", () => {
  test("deepseek: pro beats flash", () => {
    const models: ResolvableModel[] = [
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    ];
    expect(resolveModel(models, "deepseek-v4")!.id).toBe("deepseek-v4-pro");
  });

  test("mimo: pro beats base on same version", () => {
    const models: ResolvableModel[] = [
      { id: "mimo-v2.5", name: "MiMo-V2.5" },
      { id: "mimo-v2.5-pro", name: "MiMo-V2.5-Pro" },
    ];
    expect(resolveModel(models, "mimo")!.id).toBe("mimo-v2.5-pro");
  });

  test("mimo: base beats omni beats flash", () => {
    const models: ResolvableModel[] = [
      { id: "mimo-v2-flash", name: "MiMo-V2-Flash" },
      { id: "mimo-v2", name: "MiMo-V2" },
      { id: "mimo-v2-omni", name: "MiMo-V2-Omni" },
    ];
    expect(resolveModel(models, "mimo-v2")!.id).toBe("mimo-v2");
  });

  test("glm: base beats air beats flash", () => {
    const models: ResolvableModel[] = [
      { id: "glm-4.5-flash", name: "GLM-4.5-Flash" },
      { id: "glm-4.5-air", name: "GLM-4.5-Air" },
      { id: "glm-4.5", name: "GLM-4.5" },
    ];
    expect(resolveModel(models, "glm-4.5")!.id).toBe("glm-4.5");
  });

  test("qwen: max beats plus", () => {
    const models: ResolvableModel[] = [
      { id: "qwen3-plus", name: "Qwen3-Plus" },
      { id: "qwen3-max", name: "Qwen3-Max" },
    ];
    expect(resolveModel(models, "qwen3")!.id).toBe("qwen3-max");
  });

  test("qwen: plus beats turbo beats flash", () => {
    const models: ResolvableModel[] = [
      { id: "qwen-flash", name: "Qwen Flash" },
      { id: "qwen-turbo", name: "Qwen Turbo" },
      { id: "qwen-plus", name: "Qwen Plus" },
    ];
    expect(resolveModel(models, "qwen")!.id).toBe("qwen-plus");
  });

  test("claude: opus beats sonnet beats haiku", () => {
    const models: ResolvableModel[] = [
      { id: "claude-haiku-4", name: "Claude Haiku 4" },
      { id: "claude-opus-4", name: "Claude Opus 4" },
      { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
    ];
    expect(resolveModel(models, "claude")!.id).toBe("claude-opus-4");
  });

  test("gemini: pro beats flash beats flash-lite", () => {
    const models: ResolvableModel[] = [
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    ];
    expect(resolveModel(models, "gemini-2.5")!.id).toBe("gemini-2.5-pro");
  });

  test("gpt: pro beats base beats mini beats nano on broad search", () => {
    const models: ResolvableModel[] = [
      { id: "gpt-5-nano", name: "GPT-5 Nano" },
      { id: "gpt-5", name: "GPT-5" },
      { id: "gpt-5-pro", name: "GPT-5 Pro" },
      { id: "gpt-5-mini", name: "GPT-5 Mini" },
    ];
    expect(resolveModel(models, "gpt")!.id).toBe("gpt-5-pro");
  });

  test("kimi: thinking beats turbo", () => {
    const models: ResolvableModel[] = [
      { id: "kimi-k2-turbo", name: "Kimi K2 Turbo" },
      { id: "kimi-k2-thinking", name: "Kimi K2 Thinking" },
    ];
    expect(resolveModel(models, "kimi-k2")!.id).toBe("kimi-k2-thinking");
  });

  test("grok: reasoning beats non-reasoning", () => {
    const models: ResolvableModel[] = [
      { id: "grok-4-non-reasoning", name: "Grok 4 Non-Reasoning" },
      { id: "grok-4-reasoning", name: "Grok 4 Reasoning" },
    ];
    expect(resolveModel(models, "grok-4")!.id).toBe("grok-4-reasoning");
  });
});

describe("resolveModel version tiebreaker", () => {
  test("higher minor version wins on tie", () => {
    const models: ResolvableModel[] = [
      { id: "glm-4.6", name: "GLM-4.6" },
      { id: "glm-4.7", name: "GLM-4.7" },
    ];
    expect(resolveModel(models, "glm")!.id).toBe("glm-4.7");
  });

  test("higher major version wins on tie", () => {
    const models: ResolvableModel[] = [
      { id: "glm-4.5", name: "GLM-4.5" },
      { id: "glm-5", name: "GLM-5" },
    ];
    expect(resolveModel(models, "glm")!.id).toBe("glm-5");
  });

  test("v2 beats v1 on tie", () => {
    const models: ResolvableModel[] = [
      { id: "mimo-v1-pro", name: "MiMo-V1-Pro" },
      { id: "mimo-v2-pro", name: "MiMo-V2-Pro" },
    ];
    expect(resolveModel(models, "mimo")!.id).toBe("mimo-v2-pro");
  });

  test("higher point release wins on tie", () => {
    const models: ResolvableModel[] = [
      { id: "kimi-k2.5", name: "Kimi-K2.5" },
      { id: "kimi-k2.6", name: "Kimi-K2.6" },
    ];
    expect(resolveModel(models, "kimi")!.id).toBe("kimi-k2.6");
  });

  test("version number still beats signal tier", () => {
    const models: ResolvableModel[] = [
      { id: "deepseek-v2-pro", name: "DeepSeek V2 Pro" },
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    ];
    expect(resolveModel(models, "deepseek")!.id).toBe("deepseek-v4-flash");
  });
});
