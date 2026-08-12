import { kimiK3Rule } from "./kimi-k3.ts";

export interface ModelPromptRule {
  name: string;
  pattern: RegExp;
  prompt: string;
}

export const MODEL_PROMPT_RULES: ModelPromptRule[] = [kimiK3Rule];
