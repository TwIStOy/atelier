import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeManifest } from "../src/core/manifest.ts";
import { vaultLayout } from "../src/core/paths.ts";
import { appendReviewItem, resolveReviewItem } from "../src/core/review.ts";
import { renderSessionStartNotice, renderStatusSummary, type WikiStatus, wikiStatus } from "../src/core/status.ts";

let tmpRoot: string;
let vaultRoot: string;

const fixedNow = () => new Date(Date.UTC(2024, 0, 5, 9, 0, 0));

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-status-"));
  vaultRoot = path.join(tmpRoot, "vault");
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writePage(relWikiPath: string, content: string): void {
  const abs = path.join(vaultRoot, "wiki", relWikiPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function writeFileSource(packetId: string, ingestStatus: "pending" | "ingested" | "skipped"): void {
  const dir = path.join(vaultLayout(vaultRoot).sourcesRoot, packetId);
  fs.mkdirSync(dir, { recursive: true });
  writeManifest(dir, {
    schemaVersion: 1,
    id: packetId,
    packetDir: dir,
    createdAt: "2024-01-05T09:00:00.000Z",
    origin: { sourceType: "file", originPath: `/tmp/${packetId}.md`, originHash: "h" },
    contentHash: "h",
    ingest: { status: ingestStatus },
  });
}

function appendJsonl(relPath: string, records: unknown[]): void {
  const abs = path.join(vaultRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
}

describe("wikiStatus", () => {
  it("counts pages (by type), sources, and pending ingests", () => {
    writePage("concepts/a.md", "---\ntitle: A\ntype: concept\n---\n");
    writePage("entities/b.md", "---\ntitle: B\ntype: entity\n---\n");
    writePage("misc/c.md", "# no frontmatter\n");
    writeFileSource("SRC-2024-01-05-001", "ingested");
    writeFileSource("SRC-2024-01-05-002", "pending");
    writeFileSource("SRC-2024-01-05-003", "pending");

    const status = wikiStatus(vaultRoot, { now: fixedNow });

    expect(status.pages).toBe(3);
    expect(status.sources).toBe(3);
    expect(status.pagesByType).toEqual({ concept: 1, entity: 1, "(unclassified)": 1 });
    expect(status.pendingIngest).toBe(2);
  });

  it("reads the last N events most-recent-first, skipping malformed lines", () => {
    appendJsonl("meta/events.jsonl", [
      { ts: "2024-01-04T08:00:00.000Z", kind: "capture", summary: "old" },
      "{ malformed",
      { ts: "2024-01-05T09:00:00.000Z", kind: "ingest", summary: "new" },
    ]);

    const status = wikiStatus(vaultRoot, { now: fixedNow, recentEventLimit: 5 });

    expect(status.recentEvents.map((e) => e.kind)).toEqual(["ingest", "capture"]);
    expect(status.recentEvents[0]?.summary).toBe("new");
  });
});

describe("wikiStatus — pending review", () => {
  const now = () => new Date(Date.UTC(2024, 0, 5, 9, 0, 0));

  it("counts open review items, excluding resolved ones", () => {
    appendReviewItem(
      vaultRoot,
      { packetId: "SRC-2024-01-05-001", kind: "gap", title: "a", action: "create_page" },
      { now, randomSuffix: () => "0001" },
    );
    appendReviewItem(
      vaultRoot,
      { packetId: "SRC-2024-01-05-001", kind: "gap", title: "b", action: "deep_research" },
      { now, randomSuffix: () => "0002" },
    );
    const filed = appendReviewItem(
      vaultRoot,
      { packetId: "SRC-2024-01-05-001", kind: "gap", title: "c", action: "skip" },
      { now, randomSuffix: () => "0003" },
    );
    resolveReviewItem(vaultRoot, filed.id, "skip", { now });

    expect(wikiStatus(vaultRoot, { now }).pendingReview).toBe(2);
  });

  it("reports 0 pending review when the queue is empty", () => {
    expect(wikiStatus(vaultRoot, { now }).pendingReview).toBe(0);
  });
});

describe("renderStatusSummary", () => {
  it("renders counts, by-type breakdown, and recent events", () => {
    writePage("concepts/a.md", "---\ntitle: A\ntype: concept\n---\n");
    appendJsonl("meta/events.jsonl", [{ ts: "2024-01-05T09:00:00.000Z", kind: "capture", summary: "x" }]);
    const status = wikiStatus(vaultRoot, { now: fixedNow });
    const summary = renderStatusSummary(status);

    expect(summary).toContain("pages: 1   sources: 0");
    expect(summary).toContain("- concept: 1");
    expect(summary).toContain("pending ingest: 0");
    expect(summary).toContain("recent events:");
    expect(summary).toContain("capture — x");
  });
});

describe("renderSessionStartNotice", () => {
  const base: WikiStatus = {
    vault: "/v",
    generatedAt: "2024-01-05T09:00:00.000Z",
    pages: 4,
    pagesByType: { concept: 4 },
    sources: 2,
    pendingIngest: 0,
    pendingReview: 0,
    inboxUncaptured: 0,
    inboxModified: 0,
    recentEvents: [],
  };

  it("lists only non-zero pending segments", () => {
    const notice = renderSessionStartNotice({
      ...base,
      inboxUncaptured: 3,
      inboxModified: 1,
      pendingIngest: 2,
      pendingReview: 1,
    });
    expect(notice).toBe(
      "wiki: 4 pages, 2 sources · 3 new source, 1 modified source, 2 pending ingest, 1 pending review",
    );
  });

  it("reports nothing pending when all counters are zero", () => {
    expect(renderSessionStartNotice(base)).toBe("wiki: 4 pages, 2 sources · nothing pending");
  });
});
