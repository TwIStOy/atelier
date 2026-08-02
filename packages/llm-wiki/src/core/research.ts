import { resolveNow } from "@htwang-contrib/common/time";
import type { SearchResult } from "@htwang-contrib/web-tools";
import { appendJsonl } from "./atomic.ts";
import type { IngestBatchResult } from "./ingest.ts";
import { readManifest } from "./manifest.ts";
import type { CaptureResult } from "./packet.ts";
import { vaultLayout } from "./paths.ts";
import { listReviewItems, type ReviewItem, resolveReviewItem } from "./review.ts";

export const DEFAULT_DEEP_RESEARCH_MAX_RESULTS = 5;

export interface DeepResearchSearcher {
  search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]>;
}

export interface DeepResearchCapturer {
  captureUrl(url: string, signal?: AbortSignal): Promise<CaptureResult>;
}

export interface DeepResearchIngester {
  ingest(signal?: AbortSignal): Promise<IngestBatchResult>;
}

export interface UrlResearchOutcome {
  url: string;
  status: "captured" | "existed" | "failed";
  packetId?: string;
  reason?: string;
}

export type ItemResearchStatus = "resolved" | "open" | "skipped";

export interface ItemResearchOutcome {
  itemId: string;
  query: string;
  status: ItemResearchStatus;
  searched: number;
  captured: number;
  existed: number;
  ingested: number;
  ingestedIds: string[];
  urls: UrlResearchOutcome[];
  note?: string;
}

export interface DeepResearchBatchResult {
  vaultRoot: string;
  processed: number;
  resolved: number;
  leftOpen: number;
  skipped: number;
  outcomes: ItemResearchOutcome[];
}

export interface DeepResearchOptions {
  searcher: DeepResearchSearcher;
  capturer: DeepResearchCapturer;
  ingester: DeepResearchIngester;
  signal?: AbortSignal;
  maxResults?: number;
  now?: Date | (() => Date);
  itemId?: string;
}

export async function deepResearchBatch(
  vaultRoot: string,
  opts: DeepResearchOptions,
): Promise<DeepResearchBatchResult> {
  const now = resolveNow(opts.now);

  let items = listReviewItems(vaultRoot, { status: "open" }).filter((item) => item.action === "deep_research");
  if (opts.itemId !== undefined) {
    items = items.filter((item) => item.id === opts.itemId);
  }

  const outcomes: ItemResearchOutcome[] = [];
  for (const item of items) {
    outcomes.push(await researchOneItem(vaultRoot, item, opts));
  }

  const resolved = outcomes.filter((o) => o.status === "resolved").length;
  const leftOpen = outcomes.filter((o) => o.status === "open").length;
  const skipped = outcomes.filter((o) => o.status === "skipped").length;

  appendJsonl(vaultLayout(vaultRoot).events, {
    ts: now.toISOString(),
    kind: "deep_research",
    summary: `deep research: ${resolved} resolved, ${leftOpen} left open, ${skipped} skipped (${outcomes.length} item(s))`,
  });

  return { vaultRoot, processed: outcomes.length, resolved, leftOpen, skipped, outcomes };
}

async function researchOneItem(
  vaultRoot: string,
  item: ReviewItem,
  opts: DeepResearchOptions,
): Promise<ItemResearchOutcome> {
  const now = resolveNow(opts.now);
  const signal = opts.signal ?? new AbortController().signal;
  const maxResults = Math.max(1, Math.floor(opts.maxResults ?? DEFAULT_DEEP_RESEARCH_MAX_RESULTS));
  const base = {
    itemId: item.id,
    query: item.query ?? "",
    searched: 0,
    captured: 0,
    existed: 0,
    ingested: 0,
    ingestedIds: [] as string[],
    urls: [] as UrlResearchOutcome[],
  };

  if (!item.query || item.query.trim().length === 0) {
    return { ...base, status: "skipped", note: "no search query on item" };
  }

  let results: SearchResult[];
  try {
    results = await opts.searcher.search(item.query, maxResults, signal);
  } catch (err) {
    return { ...base, status: "open", note: `search failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const packetDirs: string[] = [];
  const urls: UrlResearchOutcome[] = [];
  let captured = 0;
  let existed = 0;
  for (const result of results) {
    try {
      const cap = await opts.capturer.captureUrl(result.url, signal);
      packetDirs.push(cap.manifest.packetDir);
      urls.push({
        url: result.url,
        status: cap.created ? "captured" : "existed",
        ...(cap.manifest.id !== undefined ? { packetId: cap.manifest.id } : {}),
      });
      if (cap.created) captured += 1;
      else existed += 1;
    } catch (err) {
      urls.push({
        url: result.url,
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await opts.ingester.ingest(signal);

  const ingestedIds: string[] = [];
  for (const dir of packetDirs) {
    try {
      const manifest = readManifest(dir);
      if (manifest.ingest.status === "ingested") ingestedIds.push(manifest.id);
    } catch {}
  }

  const ingested = ingestedIds.length;
  const resolved = ingested >= 1;

  if (resolved) {
    resolveReviewItem(vaultRoot, item.id, "deep_research", {
      now,
      note: `deep research: captured ${captured}, existed ${existed}, ingested ${ingested} (via wiki_deep_research)`,
    });
  }

  return {
    ...base,
    query: item.query,
    status: resolved ? "resolved" : "open",
    searched: results.length,
    captured,
    existed,
    ingested,
    ingestedIds,
    urls,
    ...(resolved ? {} : { note: ingested === 0 && results.length === 0 ? "no search results" : undefined }),
  };
}
