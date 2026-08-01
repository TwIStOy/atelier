import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { resolveNow } from "@htwang-contrib/common/time";
import { appendJsonl, atomicWriteFile } from "./atomic.ts";
import { vaultLayout } from "./paths.ts";

export const REVIEW_SCHEMA_VERSION = 1;

export type ReviewAction = "create_page" | "deep_research" | "skip";
export type ReviewStatus = "open" | "resolved";
export type ReviewFilterStatus = ReviewStatus | "all";
export const REVIEW_ACTIONS: readonly ReviewAction[] = ["create_page", "deep_research", "skip"];

export interface ReviewItem {
  schemaVersion: typeof REVIEW_SCHEMA_VERSION;
  id: string;
  filedAt: string;
  packetId: string;
  kind: string;
  title: string;
  action: ReviewAction;
  status: ReviewStatus;
  note?: string;
  query?: string;
  resolvedAt?: string;
  resolvedAction?: ReviewAction;
  resolutionNote?: string;
}

export interface AppendReviewInput {
  packetId: string;
  kind: string;
  title: string;
  action: ReviewAction;
  note?: string;
  query?: string;
}

export interface AppendReviewOptions {
  now?: Date | (() => Date);
  randomSuffix?: () => string;
}

export interface ListReviewFilter {
  status?: ReviewFilterStatus;
}

export interface ResolveReviewOptions {
  now?: Date | (() => Date);
  note?: string;
}

function defaultRandomSuffix(): string {
  return randomBytes(2).toString("hex");
}

function formatCompactUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}${mo}${d}T${h}${mi}${s}`;
}

function allocateReviewId(date: Date, suffix: string): string {
  return `REV-${formatCompactUtc(date)}-${suffix}`;
}

function normalizeAction(action: unknown): ReviewAction {
  if (isReviewAction(action)) return action;
  throw new Error(`review: action must be one of ${REVIEW_ACTIONS.join(", ")} (got ${String(action)})`);
}

function isReviewAction(value: unknown): value is ReviewAction {
  return typeof value === "string" && (REVIEW_ACTIONS as readonly string[]).includes(value);
}

export function appendReviewItem(
  vaultRoot: string,
  input: AppendReviewInput,
  opts: AppendReviewOptions = {},
): ReviewItem {
  const now = resolveNow(opts.now);
  const action = normalizeAction(input.action);
  const id = allocateReviewId(now, (opts.randomSuffix ?? defaultRandomSuffix)());

  const item: ReviewItem = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    id,
    filedAt: now.toISOString(),
    packetId: input.packetId,
    kind: input.kind,
    title: input.title,
    action,
    status: "open",
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.query !== undefined ? { query: input.query } : {}),
  };

  appendJsonl(vaultLayout(vaultRoot).review, item);
  return item;
}

export function listReviewItems(vaultRoot: string, filter: ListReviewFilter = {}): ReviewItem[] {
  const file = vaultLayout(vaultRoot).review;
  const out: ReviewItem[] = [];
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const item = coerceReviewItem(parsed);
      if (item) out.push(item);
    }
  }
  const status = filter.status;
  if (status === undefined || status === "all") return out;
  return out.filter((item) => item.status === status);
}

export function resolveReviewItem(
  vaultRoot: string,
  id: string,
  decision: ReviewAction,
  opts: ResolveReviewOptions = {},
): ReviewItem {
  const resolvedAction = normalizeAction(decision);
  const file = vaultLayout(vaultRoot).review;
  const items = listReviewItems(vaultRoot);

  const index = items.findIndex((item) => item.id === id);
  if (index === -1) {
    throw new Error(`wiki_review: item "${id}" not found`);
  }
  const target = items[index]!;
  if (target.status === "resolved") {
    throw new Error(`wiki_review: item "${id}" is already resolved`);
  }

  const now = resolveNow(opts.now);
  const resolved: ReviewItem = {
    ...target,
    status: "resolved",
    resolvedAction,
    resolvedAt: now.toISOString(),
    ...(opts.note !== undefined && opts.note.length > 0 ? { resolutionNote: opts.note } : {}),
  };
  items[index] = resolved;
  rewriteReviewFile(file, items);
  return resolved;
}

function rewriteReviewFile(file: string, items: ReviewItem[]): void {
  const body = items.map((item) => JSON.stringify(item)).join("\n");
  atomicWriteFile(file, items.length > 0 ? `${body}\n` : "");
}

function coerceReviewItem(raw: unknown): ReviewItem | null {
  if (raw === null || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.filedAt !== "string" ||
    typeof record.packetId !== "string" ||
    typeof record.kind !== "string" ||
    typeof record.title !== "string" ||
    typeof record.status !== "string" ||
    !isReviewAction(record.action)
  ) {
    return null;
  }
  const item: ReviewItem = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    id: record.id,
    filedAt: record.filedAt,
    packetId: record.packetId,
    kind: record.kind,
    title: record.title,
    action: record.action,
    status: record.status as ReviewStatus,
    ...(typeof record.note === "string" ? { note: record.note } : {}),
    ...(typeof record.query === "string" ? { query: record.query } : {}),
    ...(typeof record.resolvedAt === "string" ? { resolvedAt: record.resolvedAt } : {}),
    ...(isReviewAction(record.resolvedAction) ? { resolvedAction: record.resolvedAction } : {}),
    ...(typeof record.resolutionNote === "string" && record.resolutionNote.length > 0
      ? { resolutionNote: record.resolutionNote }
      : {}),
  };
  return item;
}
