import { MODEL_PROMPT_RULES, type ModelPromptRule } from "./rules/index.ts";

export type { ModelPromptRule } from "./rules/index.ts";

export interface ModelLike {
  provider: string;
  id: string;
}

export function modelTarget(model: ModelLike): string {
  return `${model.provider}/${model.id}`;
}

export function resolveModelPrompts(target: string, rules: ModelPromptRule[] = MODEL_PROMPT_RULES): ModelPromptRule[] {
  return rules.filter((rule) => rule.pattern.test(target));
}
