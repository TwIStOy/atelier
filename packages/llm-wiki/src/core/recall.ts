import { type BacklinksDoc, buildBacklinks, buildRegistry, type PageRegistryEntry, type RegistryDoc } from "./meta.ts";

export type SignalKind = "direct" | "source" | "adamicAdar" | "type";
export type MatchKind = "keyword" | "graph" | "vector";
export type MatchedField = "title" | "alias" | "heading" | "id" | "excerpt";

export interface SearchHit {
  id: string;
  score: number;
  matchedFields: MatchedField[];
}

export interface GraphHit {
  id: string;
  score: number;
  signals: Record<SignalKind, number>;
  viaSeeds: string[];
}

export interface RecallHit {
  vault: string;
  id: string;
  path: string;
  title: string | null;
  type: string | null;
  excerpt: string;
  sources: string[];
  score: number;
  matchedBy: MatchKind[];
  signals?: Partial<Record<SignalKind, number>>;
  matchedFields?: MatchedField[];
  viaSeeds?: string[];
  vaults?: string[];
}

export interface RecallResult {
  query: string;
  vaults: string[];
  hits: RecallHit[];
}

export interface RecallVaultOptions {
  limit?: number;
}

export interface RecallProvider {
  recall(query: string): Promise<RecallHit[]>;
}

const FIELD_WEIGHTS: Record<MatchedField, number> = {
  title: 10,
  alias: 8,
  heading: 5,
  id: 4,
  excerpt: 2,
};
const SIGNAL_WEIGHTS: Record<SignalKind, number> = {
  direct: 3,
  source: 4,
  adamicAdar: 1.5,
  type: 1,
};
const FIELD_ORDER: readonly MatchedField[] = ["title", "alias", "heading", "id", "excerpt"];
const DEFAULT_LIMIT = 20;
const SEED_CAP = 20;

export function tokenizeQuery(query: string): string[] {
  const raw = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((s) => s.length > 0);
  return [...new Set(raw)];
}

export function searchRegistry(registry: RegistryDoc, query: string): SearchHit[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const page of registry.pages) {
    const fields = fieldTexts(page);
    const matchedFields: MatchedField[] = [];
    let score = 0;
    for (const field of FIELD_ORDER) {
      const text = fields[field];
      if (text.length === 0) continue;
      const lowered = text.toLowerCase();
      let matched = false;
      for (const token of tokens) {
        if (lowered.includes(token)) {
          score += FIELD_WEIGHTS[field];
          matched = true;
        }
      }
      if (matched) matchedFields.push(field);
    }
    if (score > 0) hits.push({ id: page.id, score, matchedFields });
  }
  return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function fieldTexts(page: PageRegistryEntry): Record<MatchedField, string> {
  return {
    title: page.title ?? "",
    alias: page.aliases.join(" "),
    heading: page.headings.join(" "),
    id: page.id,
    excerpt: page.excerpt,
  };
}

export function expandByGraph(seeds: string[], registry: RegistryDoc, backlinks: BacklinksDoc): GraphHit[] {
  const uniqueSeeds = [...new Set(seeds.filter((s) => s.length > 0))];
  if (uniqueSeeds.length === 0) return [];

  const pagesById = new Map<string, PageRegistryEntry>();
  for (const p of registry.pages) pagesById.set(p.id, p);

  const neighborCache = new Map<string, Set<string>>();
  const neighbors = (id: string): Set<string> => {
    const cached = neighborCache.get(id);
    if (cached) return cached;
    const out = new Set<string>();
    const p = pagesById.get(id);
    if (p) for (const link of p.links) if (link !== id) out.add(link);
    const bl = backlinks.backlinks[id];
    if (bl) for (const src of bl) if (src !== id) out.add(src);
    neighborCache.set(id, out);
    return out;
  };

  interface SeedData {
    type: string | null;
    sources: Set<string>;
    neighbors: Set<string>;
  }
  const seedData = new Map<string, SeedData>();
  for (const s of uniqueSeeds) {
    const p = pagesById.get(s);
    seedData.set(s, {
      type: p?.type ?? null,
      sources: new Set(p?.sources ?? []),
      neighbors: neighbors(s),
    });
  }

  const hits: GraphHit[] = [];
  for (const page of registry.pages) {
    const activeSeeds = uniqueSeeds.filter((s) => s !== page.id);
    if (activeSeeds.length === 0) continue;

    const candNeighbors = neighbors(page.id);
    const signals: Record<SignalKind, number> = { direct: 0, source: 0, adamicAdar: 0, type: 0 };
    const viaSeeds = new Set<string>();

    const activeTypes = new Set<string>();
    const activeSources = new Set<string>();
    for (const s of activeSeeds) {
      const sd = seedData.get(s);
      if (!sd) continue;
      if (sd.type) activeTypes.add(sd.type);
      for (const src of sd.sources) activeSources.add(src);
    }

    for (const s of activeSeeds) {
      const sd = seedData.get(s);
      if (!sd) continue;
      if (sd.neighbors.has(page.id)) {
        signals.direct += SIGNAL_WEIGHTS.direct;
        viaSeeds.add(s);
      }
      let aaSeed = 0;
      for (const n of candNeighbors) {
        if (sd.neighbors.has(n)) {
          const deg = neighbors(n).size;
          if (deg > 1) aaSeed += 1 / Math.log(deg);
        }
      }
      if (aaSeed > 0) {
        signals.adamicAdar += aaSeed * SIGNAL_WEIGHTS.adamicAdar;
        viaSeeds.add(s);
      }
    }

    let sharedSources = 0;
    for (const src of page.sources) if (activeSources.has(src)) sharedSources += 1;
    if (sharedSources > 0) {
      signals.source = sharedSources * SIGNAL_WEIGHTS.source;
      for (const s of activeSeeds) {
        const sd = seedData.get(s);
        if (sd && page.sources.some((x) => sd.sources.has(x))) viaSeeds.add(s);
      }
    }

    if (page.type && activeTypes.has(page.type)) signals.type = SIGNAL_WEIGHTS.type;

    const score = signals.direct + signals.source + signals.adamicAdar + signals.type;
    if (score > 0) hits.push({ id: page.id, score, signals, viaSeeds: [...viaSeeds].sort() });
  }
  return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function recallVault(vaultRoot: string, query: string, opts: RecallVaultOptions = {}): RecallResult {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const registry = buildRegistry(vaultRoot);
  const backlinks = buildBacklinks(registry);
  const pagesById = new Map<string, PageRegistryEntry>();
  for (const p of registry.pages) pagesById.set(p.id, p);

  const searchHits = searchRegistry(registry, query);
  const seedIds = searchHits.slice(0, SEED_CAP).map((h) => h.id);
  const graphHits = expandByGraph(seedIds, registry, backlinks);

  const byId = new Map<string, RecallHit>();
  for (const sh of searchHits) {
    const page = pagesById.get(sh.id);
    if (!page) continue;
    byId.set(sh.id, hitFromPage(vaultRoot, page, sh.score, ["keyword"], { matchedFields: sh.matchedFields }));
  }
  for (const gh of graphHits) {
    const page = pagesById.get(gh.id);
    if (!page) continue;
    const existing = byId.get(gh.id);
    if (existing) {
      if (!existing.matchedBy.includes("graph")) existing.matchedBy.push("graph");
      existing.score += gh.score;
      existing.signals = gh.signals;
      existing.viaSeeds = gh.viaSeeds;
    } else {
      byId.set(
        gh.id,
        hitFromPage(vaultRoot, page, gh.score, ["graph"], { signals: gh.signals, viaSeeds: gh.viaSeeds }),
      );
    }
  }

  const hits = [...byId.values()].sort(byScoreDesc).slice(0, Math.max(0, limit));
  return { query, vaults: [vaultRoot], hits };
}

export function mergeVaultResults(results: RecallResult[]): RecallResult {
  const query = results[0]?.query ?? "";
  const vaults = [...new Set(results.flatMap((r) => r.vaults))].sort();
  const byId = new Map<string, RecallHit>();

  for (const r of results) {
    for (const hit of r.hits) {
      const existing = byId.get(hit.id);
      if (!existing) {
        byId.set(hit.id, { ...hit, vaults: [hit.vault] });
        continue;
      }
      const mergedVaults = unionVaults(existing.vault, existing.vaults, [hit.vault]);
      const mergedMatchedBy = unionMatchedBy(existing.matchedBy, hit.matchedBy);
      if (hit.score > existing.score) {
        byId.set(hit.id, { ...hit, vaults: mergedVaults, matchedBy: mergedMatchedBy });
      } else {
        existing.vaults = mergedVaults;
        existing.matchedBy = mergedMatchedBy;
      }
    }
  }

  const hits = [...byId.values()].sort(byScoreDesc);
  return { query, vaults, hits };
}

export interface RecallAcrossOptions extends RecallVaultOptions {
  provider?: RecallProvider;
}

export async function recallAcross(
  vaultRoots: string[],
  query: string,
  opts: RecallAcrossOptions = {},
): Promise<RecallResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const vaultResults = vaultRoots.map((v) => recallVault(v, query, opts));
  const local = mergeVaultResults(vaultResults);
  if (!opts.provider) return capHits(local, limit);
  const providerHits = await opts.provider.recall(query);
  return capHits(mergeWithProviderHits(local, providerHits), limit);
}

function capHits(result: RecallResult, limit: number): RecallResult {
  return { ...result, hits: result.hits.slice(0, Math.max(0, limit)) };
}

function mergeWithProviderHits(local: RecallResult, providerHits: RecallHit[]): RecallResult {
  const byId = new Map<string, RecallHit>();
  for (const h of local.hits) byId.set(h.id, { ...h });
  for (const ph of providerHits) {
    const existing = byId.get(ph.id);
    if (existing) {
      existing.matchedBy = unionMatchedBy(existing.matchedBy, ph.matchedBy, "vector");
      existing.vaults = unionVaults(existing.vault, existing.vaults, [ph.vault, ...(ph.vaults ?? [])]);
      if (ph.score > existing.score) {
        existing.score = ph.score;
        if (ph.signals) existing.signals = { ...existing.signals, ...ph.signals };
      }
    } else {
      byId.set(ph.id, { ...ph, matchedBy: unionMatchedBy(ph.matchedBy, [], "vector") });
    }
  }
  const vaults = [...new Set([...local.vaults, ...providerHits.flatMap((h) => [h.vault, ...(h.vaults ?? [])])])].sort();
  const hits = [...byId.values()].sort(byScoreDesc);
  return { query: local.query, vaults, hits };
}

function unionMatchedBy(existing: MatchKind[], incoming: MatchKind[], ...extra: MatchKind[]): MatchKind[] {
  return [...new Set<MatchKind>([...existing, ...incoming, ...extra])];
}

function unionVaults(primary: string, known: string[] | undefined, incoming: string[]): string[] {
  return [...new Set([...(known ?? [primary]), ...incoming])];
}

function hitFromPage(
  vaultRoot: string,
  page: PageRegistryEntry,
  score: number,
  matchedBy: MatchKind[],
  extra: Pick<RecallHit, "matchedFields" | "signals" | "viaSeeds">,
): RecallHit {
  return {
    vault: vaultRoot,
    id: page.id,
    path: page.path,
    title: page.title,
    type: page.type,
    excerpt: page.excerpt,
    sources: page.sources,
    score,
    matchedBy,
    matchedFields: extra.matchedFields,
    signals: extra.signals,
    viaSeeds: extra.viaSeeds,
  };
}

function byScoreDesc(a: RecallHit, b: RecallHit): number {
  return b.score - a.score || a.id.localeCompare(b.id);
}
