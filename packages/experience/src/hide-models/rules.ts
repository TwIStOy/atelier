export interface ParsedTarget {
  provider: string;
  model: string | null;
}

export function parseTarget(raw: string): ParsedTarget | null {
  const s = raw.trim();
  if (!s) return null;
  const slash = s.indexOf("/");
  if (slash === -1) {
    return s.toLowerCase() ? { provider: s.toLowerCase(), model: null } : null;
  }
  const provider = s.slice(0, slash).trim().toLowerCase();
  const modelRaw = s.slice(slash + 1).trim();
  if (!provider) return null;
  if (modelRaw === "" || modelRaw === "*") return { provider, model: null };
  return { provider, model: modelRaw };
}

export function canonicalRule(parsed: ParsedTarget): string {
  return parsed.model == null ? parsed.provider : `${parsed.provider}/${parsed.model}`;
}

export function parseCanonical(raw: string): string | null {
  const parsed = parseTarget(raw);
  return parsed ? canonicalRule(parsed) : null;
}

export function addRule(rules: readonly string[], canonical: string): string[] {
  return rules.includes(canonical) ? [...rules] : [...rules, canonical];
}

export function removeRule(rules: readonly string[], canonical: string): string[] {
  return rules.filter((r) => r !== canonical);
}

export interface RuleSet {
  wholeProviders: Set<string>;
  specificModels: Set<string>;
}

export function buildRuleSet(rules: readonly string[]): RuleSet {
  const wholeProviders = new Set<string>();
  const specificModels = new Set<string>();
  for (const raw of rules) {
    const parsed = parseTarget(raw);
    if (!parsed) continue;
    if (parsed.model == null) wholeProviders.add(parsed.provider);
    else specificModels.add(`${parsed.provider}/${parsed.model}`);
  }
  return { wholeProviders, specificModels };
}

export function isModelHidden(provider: string, modelId: string, rs: RuleSet): boolean {
  const p = provider.toLowerCase();
  if (rs.wholeProviders.has(p)) return true;
  return rs.specificModels.has(`${p}/${modelId}`);
}

export function describeRule(canonical: string): string {
  const parsed = parseTarget(canonical);
  if (!parsed) return canonical;
  return parsed.model == null ? `${parsed.provider} (whole provider)` : `${parsed.provider}/${parsed.model}`;
}
