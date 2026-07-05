import { type ExtensionConfigSchema, readConfig, updateConfig } from "@htwang-contrib/common";
import { addRule, canonicalRule, parseTarget, removeRule } from "./rules.ts";

export const CONFIG_ID = "experience";

export interface ExperienceConfig {
  enabled: boolean;
  hiddenRules: string[];
}

export const DEFAULT_CONFIG: ExperienceConfig = {
  enabled: true,
  hiddenRules: [],
};

export const CONFIG_SCHEMA: ExtensionConfigSchema<ExperienceConfig> = {
  defaults: DEFAULT_CONFIG,
};

export function loadConfig(): ExperienceConfig {
  return readConfig(CONFIG_ID, CONFIG_SCHEMA);
}

export interface RuleChangeResult {
  rules: string[];
  changed: boolean;
  canonical: string | null;
  matched: boolean;
}

export function addHiddenRule(raw: string): RuleChangeResult {
  const parsed = parseTarget(raw);
  if (!parsed) return { rules: loadConfig().hiddenRules, changed: false, canonical: null, matched: false };
  const canonical = canonicalRule(parsed);
  const cfg = loadConfig();
  const rules = addRule(cfg.hiddenRules, canonical);
  if (rules.length === cfg.hiddenRules.length) {
    return { rules, changed: false, canonical, matched: true };
  }
  updateConfig(CONFIG_ID, CONFIG_SCHEMA, { hiddenRules: rules });
  return { rules, changed: true, canonical, matched: true };
}

export function removeHiddenRule(raw: string): RuleChangeResult {
  const parsed = parseTarget(raw);
  if (!parsed) return { rules: loadConfig().hiddenRules, changed: false, canonical: null, matched: false };
  const canonical = canonicalRule(parsed);
  const cfg = loadConfig();
  const rules = removeRule(cfg.hiddenRules, canonical);
  if (rules.length === cfg.hiddenRules.length) {
    return { rules, changed: false, canonical, matched: true };
  }
  updateConfig(CONFIG_ID, CONFIG_SCHEMA, { hiddenRules: rules });
  return { rules, changed: true, canonical, matched: true };
}
