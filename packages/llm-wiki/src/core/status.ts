import { scanInbox } from "./inbox.ts";
import { buildRegistry, type RegistryDoc, readEvents } from "./meta.ts";
import { vaultLayout } from "./paths.ts";
import { listReviewItems } from "./review.ts";

export interface WikiStatusEvent {
  ts: string;
  kind: string;
  summary: string;
}

export interface WikiStatus {
  vault: string;
  generatedAt: string;
  pages: number;
  pagesByType: Record<string, number>;
  sources: number;
  pendingIngest: number;
  pendingReview: number;
  inboxUncaptured: number;
  inboxModified: number;
  recentEvents: WikiStatusEvent[];
}

export interface StatusOptions {
  now?: () => Date;
  recentEventLimit?: number;
}

const DEFAULT_RECENT_EVENT_LIMIT = 5;
const UNCLASSIFIED_TYPE = "(unclassified)";

export function wikiStatus(vaultRoot: string, opts: StatusOptions = {}): WikiStatus {
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const registry = buildRegistry(vaultRoot, { now: opts.now });
  const inbox = scanInbox(vaultRoot);
  const recentEvents = readRecentEvents(
    vaultLayout(vaultRoot).events,
    opts.recentEventLimit ?? DEFAULT_RECENT_EVENT_LIMIT,
  );

  const pendingIngest = registry.sources.filter((s) => s.ingestStatus === "pending").length;

  return {
    vault: vaultRoot,
    generatedAt,
    pages: registry.pages.length,
    pagesByType: countByType(registry),
    sources: registry.sources.length,
    pendingIngest,
    pendingReview: listReviewItems(vaultRoot, { status: "open" }).length,
    inboxUncaptured: inbox.uncaptured.length,
    inboxModified: inbox.modified.length,
    recentEvents,
  };
}

export function renderStatusSummary(status: WikiStatus): string {
  const typeLines = Object.entries(status.pagesByType)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `  - ${type}: ${count}`);
  const lines = [
    `Wiki status for ${status.vault}`,
    `pages: ${status.pages}   sources: ${status.sources}`,
    ...typeLines,
    `pending ingest: ${status.pendingIngest}   pending review: ${status.pendingReview}`,
    `inbox: ${status.inboxUncaptured} new, ${status.inboxModified} modified`,
  ];
  if (status.recentEvents.length > 0) {
    lines.push("recent events:");
    for (const event of status.recentEvents) {
      lines.push(`  - ${event.ts} ${event.kind}${event.summary ? ` — ${event.summary}` : ""}`);
    }
  }
  return lines.join("\n");
}

export function renderSessionStartNotice(status: WikiStatus): string {
  const head = `wiki: ${status.pages} pages, ${status.sources} sources`;
  const segments: string[] = [];
  if (status.inboxUncaptured > 0) segments.push(`${status.inboxUncaptured} new source`);
  if (status.inboxModified > 0) segments.push(`${status.inboxModified} modified source`);
  if (status.pendingIngest > 0) segments.push(`${status.pendingIngest} pending ingest`);
  if (status.pendingReview > 0) segments.push(`${status.pendingReview} pending review`);
  if (segments.length === 0) return `${head} · nothing pending`;
  return `${head} · ${segments.join(", ")}`;
}

function countByType(registry: RegistryDoc): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const page of registry.pages) {
    const key = page.type ?? UNCLASSIFIED_TYPE;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function readRecentEvents(eventsPath: string, limit: number): WikiStatusEvent[] {
  const raw = readEvents(eventsPath);
  const mapped: WikiStatusEvent[] = [];
  for (const entry of raw) {
    const event = toStatusEvent(entry);
    if (event) mapped.push(event);
  }
  return mapped.slice(-limit).reverse();
}

function toStatusEvent(raw: unknown): WikiStatusEvent | null {
  if (raw === null || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  return {
    ts: typeof record.ts === "string" ? record.ts : "",
    kind: typeof record.kind === "string" ? record.kind : "(event)",
    summary: typeof record.summary === "string" ? record.summary : "",
  };
}
