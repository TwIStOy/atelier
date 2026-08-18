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

export function replaceSystemPromptFirstLine(text: string, firstLine: string): string {
  const newline = text.indexOf("\n");
  if (newline === -1) return firstLine;
  return firstLine + text.slice(newline);
}

export function applyModelPromptRules(systemPrompt: string, rules: ModelPromptRule[]): string | null {
  if (rules.length === 0) return null;
  let next = systemPrompt;
  let firstLine: string | undefined;
  const appends: string[] = [];
  for (const rule of rules) {
    if (rule.replaceFirstLine !== undefined) firstLine = rule.replaceFirstLine;
    if (rule.prompt !== undefined && rule.prompt.length > 0) appends.push(rule.prompt);
  }
  let changed = false;
  if (firstLine !== undefined) {
    next = replaceSystemPromptFirstLine(next, firstLine);
    changed = true;
  }
  if (appends.length > 0) {
    next = [next, ...appends].join("\n\n");
    changed = true;
  }
  return changed ? next : null;
}
