import { deepseekV4Rule } from "./deepseek-v4.ts";
import { kimiK3Rule } from "./kimi-k3.ts";

export interface ModelPromptRule {
  name: string;
  pattern: RegExp;
  prompt?: string;
  replaceFirstLine?: string;
}

export const MODEL_PROMPT_RULES: ModelPromptRule[] = [kimiK3Rule, deepseekV4Rule];
