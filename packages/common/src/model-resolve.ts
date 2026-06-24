export interface ResolvableModel {
  id: string;
  name: string;
  provider?: string;
}

const TIER_EXACT_PROVIDER_MODEL = 4;
const TIER_EXACT_ID = 3;
const TIER_ID_CONTAINS = 2;
const TIER_NAME_CONTAINS = 1;
const TIER_PROVIDER_ID_CONTAINS = 0;

function matchTier(model: ResolvableModel, pattern: string): { tier: number; target: string } | null {
  const p = pattern.toLowerCase();
  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();
  const provider = (model.provider ?? "").toLowerCase();
  const providerSlashId = provider ? `${provider}/${id}` : "";

  if (providerSlashId && p === providerSlashId) return { tier: TIER_EXACT_PROVIDER_MODEL, target: providerSlashId };
  if (id === p) return { tier: TIER_EXACT_ID, target: id };
  if (id.includes(p)) return { tier: TIER_ID_CONTAINS, target: id };
  if (name.includes(p)) return { tier: TIER_NAME_CONTAINS, target: name };
  if (providerSlashId.includes(p)) return { tier: TIER_PROVIDER_ID_CONTAINS, target: providerSlashId };

  return null;
}

type SignalRule = {
  prefix: RegExp;
  tiers: Record<string, number>;
};

const SIGNAL_RULES: SignalRule[] = [
  {
    prefix: /^claude-/,
    tiers: { haiku: 1, sonnet: 2, opus: 3 },
  },
  {
    prefix: /^(gpt-|o[0-9])/,
    tiers: { nano: 1, mini: 2, pro: 4 },
  },
  {
    prefix: /^gemini-/,
    tiers: { "flash-lite": 1, flash: 2, pro: 3 },
  },
  {
    prefix: /^deepseek-/,
    tiers: { chat: 1, flash: 2, reasoner: 3, pro: 4 },
  },
  {
    prefix: /^glm-/,
    tiers: { flashx: 1, flash: 2, air: 3 },
  },
  {
    prefix: /^(qwen|qwq)-/,
    tiers: { flash: 1, turbo: 2, plus: 3, max: 4 },
  },
  {
    prefix: /^kimi-/,
    tiers: { preview: 1, turbo: 2, thinking: 3 },
  },
  {
    prefix: /^grok-/,
    tiers: { "non-reasoning": 1, reasoning: 2 },
  },
  {
    prefix: /^mimo-/,
    tiers: { flash: 1, omni: 2, pro: 3 },
  },
];

function signalScore(id: string): number {
  const lower = id.toLowerCase();
  for (const rule of SIGNAL_RULES) {
    if (!rule.prefix.test(lower)) continue;
    let best = 0;
    for (const [key, tier] of Object.entries(rule.tiers)) {
      if (lower.includes(key) && tier > best) best = tier;
    }
    return best;
  }
  return 0;
}

const VERSION_RE = /(\d+)/g;

function compareVersion(a: string, b: string): number {
  const pa = a.match(VERSION_RE) ?? [];
  const pb = b.match(VERSION_RE) ?? [];
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Number(pa[i] ?? -1);
    const nb = Number(pb[i] ?? -1);
    if (na !== nb) return na - nb;
  }
  return 0;
}

function ratioScore(pattern: string, target: string): number {
  return pattern.length / target.length;
}

interface RankedMatch {
  model: ResolvableModel;
  tier: number;
  version: string[];
  signal: number;
  ratio: number;
}

function parseVersion(id: string): string[] {
  return id.toLowerCase().match(VERSION_RE) ?? [];
}

function compareRanked(a: RankedMatch, b: RankedMatch): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  const v = compareVersion(a.model.id, b.model.id);
  if (v !== 0) return v;
  if (a.signal !== b.signal) return a.signal - b.signal;
  return a.ratio - b.ratio;
}

export function resolveModel<T extends ResolvableModel>(models: T[], pattern: string): T | undefined {
  if (models.length === 0 || !pattern) return undefined;

  let best: RankedMatch | undefined;

  for (const model of models) {
    const m = matchTier(model, pattern);
    if (!m) continue;

    const ranked: RankedMatch = {
      model,
      tier: m.tier,
      version: parseVersion(model.id),
      signal: signalScore(model.id),
      ratio: ratioScore(pattern, m.target),
    };

    if (!best || compareRanked(ranked, best) > 0) {
      best = ranked;
    }
  }

  return (best?.model ?? undefined) as T | undefined;
}
