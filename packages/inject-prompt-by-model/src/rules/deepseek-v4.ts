import type { ModelPromptRule } from "./index.ts";

export const DEEPSEEK_V4_FIRST_LINE =
  'You are a helpful software engineer assistant. When you think, think in ENGLISH, start with "We need..".';

export const deepseekV4Rule: ModelPromptRule = {
  name: "deepseek-v4",
  pattern: /deepseek-v4-(?:flash|pro)/,
  replaceFirstLine: DEEPSEEK_V4_FIRST_LINE,
};
