import { describe, expect, test } from "vitest";
import { guessDisplayName } from "../src/catalog.ts";

describe("guessDisplayName", () => {
  test("brand acronym uppercased with dotted version", () => {
    expect(guessDisplayName("glm-5.2")).toBe("GLM 5.2");
  });

  test("merges trailing numeric segments into a dotted version", () => {
    expect(guessDisplayName("claude-sonnet-4-6")).toBe("Claude Sonnet 4.6");
  });

  test("preserves mid-token version and title-cases suffix", () => {
    expect(guessDisplayName("gpt-5.6-sol")).toBe("GPT 5.6 Sol");
  });

  test("known brand map entries", () => {
    expect(guessDisplayName("deepseek-r1")).toBe("DeepSeek R1");
    expect(guessDisplayName("kimi-k3")).toBe("Kimi K3");
    expect(guessDisplayName("qwen-max")).toBe("Qwen Max");
    expect(guessDisplayName("grok-4.5")).toBe("Grok 4.5");
  });

  test("single trailing numeric segment is not dotted", () => {
    expect(guessDisplayName("qwen-3")).toBe("Qwen 3");
  });

  test("hy3 brand keeps digits", () => {
    expect(guessDisplayName("hy3-standard")).toBe("HY3 Standard");
  });

  test("empty input returns empty string", () => {
    expect(guessDisplayName("")).toBe("");
  });
});
