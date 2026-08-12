export interface ModelPromptRule {
  name: string;
  pattern: RegExp;
  prompt: string;
}

export interface ModelLike {
  provider: string;
  id: string;
}

export const MODEL_PROMPT_RULES: ModelPromptRule[] = [];

export function modelTarget(model: ModelLike): string {
  return `${model.provider}/${model.id}`;
}

export function resolveModelPrompt(
  target: string,
  rules: ModelPromptRule[] = MODEL_PROMPT_RULES,
): ModelPromptRule | null {
  for (const rule of rules) {
    if (rule.pattern.test(target)) return rule;
  }
  return null;
}
