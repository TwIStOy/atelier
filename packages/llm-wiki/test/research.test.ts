import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapVault } from "../src/core/bootstrap.ts";
import type { IngestBatchResult } from "../src/core/ingest.ts";
import { readManifest } from "../src/core/manifest.ts";
import { captureSource } from "../src/core/packet.ts";
import { vaultLayout } from "../src/core/paths.ts";
import {
  DEFAULT_DEEP_RESEARCH_MAX_RESULTS,
  type DeepResearchCapturer,
  type DeepResearchIngester,
  type DeepResearchSearcher,
  deepResearchBatch,
  type ItemResearchOutcome,
} from "../src/core/research.ts";
import { listReviewItems } from "../src/core/review.ts";

let tmpRoot: string;
let vaultRoot: string;

const FIXED_DATE = () => new Date(Date.UTC(2024, 0, 5, 9, 0, 0));

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-research-"));
  vaultRoot = path.join(tmpRoot, "vault");
  bootstrapVault(vaultRoot, { now: FIXED_DATE });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function fileDeepResearchItem(
  query: string | undefined,
  opts: { packetId?: string; status?: "open" | "resolved" } = {},
): string {
  const item = listReviewItems(vaultRoot);
  const id = `REV-20240105T090000-${String(item.length + 1).padStart(2, "0")}`;
  const status = opts.status ?? "open";
  const line = JSON.stringify({
    schemaVersion: 1,
    id,
    filedAt: FIXED_DATE().toISOString(),
    packetId: opts.packetId ?? "SRC-2024-01-05-001",
    kind: "coverage_gap",
    title: `research ${id}`,
    action: "deep_research",
    status,
    ...(status === "resolved" ? { resolvedAction: "deep_research", resolvedAt: FIXED_DATE().toISOString() } : {}),
    ...(query !== undefined ? { query } : {}),
  });
  fs.appendFileSync(vaultLayout(vaultRoot).review, `${line}\n`);
  return id;
}

function fakeSearcher(resultsByQuery: Record<string, Array<{ url: string; title?: string }>>): DeepResearchSearcher {
  return {
    async search(query, maxResults) {
      const hits = resultsByQuery[query] ?? [];
      return hits.slice(0, maxResults).map((h) => ({ title: h.title ?? h.url, url: h.url, snippet: "" }));
    },
  };
}

function fakeCapturer(): DeepResearchCapturer {
  const sourcesDir = vaultLayout(vaultRoot).sourcesRoot;
  return {
    async captureUrl(url) {
      return captureSource(
        { sourceType: "text", text: `# ${url}\n\nbody for ${url}`, title: url },
        { sourcesDir, now: FIXED_DATE },
      );
    },
  };
}

function fakeIngester(opts: { failIf?: (packetId: string) => boolean } = {}): DeepResearchIngester {
  return {
    async ingest() {
      const sourcesRoot = vaultLayout(vaultRoot).sourcesRoot;
      const outcomes: IngestBatchResult["outcomes"] = [];
      let ingested = 0;
      let failed = 0;
      if (fs.existsSync(sourcesRoot)) {
        for (const name of fs.readdirSync(sourcesRoot).sort()) {
          if (!name.startsWith("SRC-")) continue;
          const dir = path.join(sourcesRoot, name);
          const manifest = readManifest(dir);
          if (manifest.ingest.status !== "pending") continue;
          if (opts.failIf?.(manifest.id)) {
            failed += 1;
            outcomes.push({
              packetId: manifest.id,
              status: "failed",
              pagesCreated: 0,
              pagesExisted: 0,
              reviewFiled: 0,
            });
            continue;
          }
          fs.writeFileSync(
            path.join(dir, "manifest.json"),
            JSON.stringify({ ...manifest, ingest: { status: "ingested", ingestedAt: FIXED_DATE().toISOString() } }),
          );
          ingested += 1;
          outcomes.push({
            packetId: manifest.id,
            status: "ingested",
            pagesCreated: 1,
            pagesExisted: 0,
            reviewFiled: 0,
          });
        }
      }
      return { processed: outcomes.length, ingested, skipped: 0, failed, outcomes };
    },
  };
}

describe("deepResearchBatch — happy path", () => {
  it("searches, captures each URL, ingests, and resolves the item when >=1 packet lands", async () => {
    const itemId = fileDeepResearchItem("foo examples");
    const searcher = fakeSearcher({ "foo examples": [{ url: "https://a.example" }, { url: "https://b.example" }] });

    const result = await deepResearchBatch(vaultRoot, {
      searcher,
      capturer: fakeCapturer(),
      ingester: fakeIngester(),
      now: FIXED_DATE,
    });

    expect(result.processed).toBe(1);
    expect(result.resolved).toBe(1);
    expect(result.leftOpen).toBe(0);
    expect(result.skipped).toBe(0);

    const outcome = result.outcomes[0] as ItemResearchOutcome;
    expect(outcome.itemId).toBe(itemId);
    expect(outcome.status).toBe("resolved");
    expect(outcome.searched).toBe(2);
    expect(outcome.captured).toBe(2);
    expect(outcome.existed).toBe(0);
    expect(outcome.ingested).toBe(2);
    expect(outcome.ingestedIds).toHaveLength(2);

    const items = listReviewItems(vaultRoot);
    expect(items[0].status).toBe("resolved");
    expect(items[0].resolvedAction).toBe("deep_research");
  });

  it("uses the configured maxResults to cap search results", async () => {
    fileDeepResearchItem("many");
    const searcher = fakeSearcher({
      many: [
        { url: "https://1.example" },
        { url: "https://2.example" },
        { url: "https://3.example" },
        { url: "https://4.example" },
      ],
    });

    const result = await deepResearchBatch(vaultRoot, {
      searcher,
      capturer: fakeCapturer(),
      ingester: fakeIngester(),
      maxResults: 2,
      now: FIXED_DATE,
    });

    expect(result.outcomes[0].searched).toBe(2);
  });

  it("defaults maxResults to the documented constant when omitted", async () => {
    fileDeepResearchItem("q");
    let observed: number | undefined;
    const searcher: DeepResearchSearcher = {
      async search(_query, maxResults) {
        observed = maxResults;
        return [];
      },
    };

    await deepResearchBatch(vaultRoot, {
      searcher,
      capturer: fakeCapturer(),
      ingester: fakeIngester(),
      now: FIXED_DATE,
    });

    expect(observed).toBe(DEFAULT_DEEP_RESEARCH_MAX_RESULTS);
  });
});

describe("deepResearchBatch — resolve gate", () => {
  it("leaves the item open when ingest fails to land any packet", async () => {
    const itemId = fileDeepResearchItem("q");
    const searcher = fakeSearcher({ q: [{ url: "https://a.example" }] });

    const result = await deepResearchBatch(vaultRoot, {
      searcher,
      capturer: fakeCapturer(),
      ingester: fakeIngester({ failIf: () => true }),
      now: FIXED_DATE,
    });

    expect(result.resolved).toBe(0);
    expect(result.leftOpen).toBe(1);
    const outcome = result.outcomes[0] as ItemResearchOutcome;
    expect(outcome.itemId).toBe(itemId);
    expect(outcome.status).toBe("open");
    expect(outcome.ingested).toBe(0);

    const items = listReviewItems(vaultRoot);
    expect(items[0].status).toBe("open");
  });

  it("resolves as soon as a single packet ingests even when others fail", async () => {
    fileDeepResearchItem("q");
    const searcher = fakeSearcher({ q: [{ url: "https://a.example" }, { url: "https://b.example" }] });

    let firstSeen: string | undefined;
    const result = await deepResearchBatch(vaultRoot, {
      searcher,
      capturer: fakeCapturer(),
      ingester: fakeIngester({
        failIf: (packetId) => {
          if (firstSeen === undefined) firstSeen = packetId;
          return packetId !== firstSeen;
        },
      }),
      now: FIXED_DATE,
    });

    expect(result.resolved).toBe(1);
    const outcome = result.outcomes[0] as ItemResearchOutcome;
    expect(outcome.ingested).toBe(1);
    expect(outcome.captured).toBe(2);
  });
});

describe("deepResearchBatch — skips and failures", () => {
  it("skips (does not block) items that have no query", async () => {
    const noQuery = fileDeepResearchItem(undefined);
    const withQuery = fileDeepResearchItem("real query");
    const searcher = fakeSearcher({ "real query": [{ url: "https://a.example" }] });

    const result = await deepResearchBatch(vaultRoot, {
      searcher,
      capturer: fakeCapturer(),
      ingester: fakeIngester(),
      now: FIXED_DATE,
    });

    expect(result.processed).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.resolved).toBe(1);

    const skipped = result.outcomes.find((o) => o.itemId === noQuery) as ItemResearchOutcome;
    expect(skipped.status).toBe("skipped");
    expect(skipped.searched).toBe(0);
    const resolved = result.outcomes.find((o) => o.itemId === withQuery) as ItemResearchOutcome;
    expect(resolved.status).toBe("resolved");

    const items = listReviewItems(vaultRoot);
    const skippedItem = items.find((i) => i.id === noQuery);
    expect(skippedItem?.status).toBe("open");
  });

  it("leaves the item open (does not skip) when search throws", async () => {
    const itemId = fileDeepResearchItem("boom");
    const searcher: DeepResearchSearcher = {
      async search() {
        throw new Error("all providers failed");
      },
    };

    const result = await deepResearchBatch(vaultRoot, {
      searcher,
      capturer: fakeCapturer(),
      ingester: fakeIngester(),
      now: FIXED_DATE,
    });

    expect(result.leftOpen).toBe(1);
    expect(result.skipped).toBe(0);
    const outcome = result.outcomes[0] as ItemResearchOutcome;
    expect(outcome.itemId).toBe(itemId);
    expect(outcome.status).toBe("open");
    expect(outcome.note).toMatch(/all providers failed/);
  });

  it("leaves the item open when search returns no results", async () => {
    fileDeepResearchItem("empty");
    const searcher = fakeSearcher({});

    const result = await deepResearchBatch(vaultRoot, {
      searcher,
      capturer: fakeCapturer(),
      ingester: fakeIngester(),
      now: FIXED_DATE,
    });

    expect(result.leftOpen).toBe(1);
    const outcome = result.outcomes[0] as ItemResearchOutcome;
    expect(outcome.searched).toBe(0);
    expect(outcome.status).toBe("open");
  });

  it("records a failed URL outcome without aborting the rest of the batch for the item", async () => {
    fileDeepResearchItem("q");
    const searcher = fakeSearcher({ q: [{ url: "https://a.example" }, { url: "https://b.example" }] });

    let first = true;
    const capturer: DeepResearchCapturer = {
      async captureUrl(url) {
        if (first) {
          first = false;
          throw new Error("network down");
        }
        return fakeCapturer().captureUrl(url);
      },
    };

    const result = await deepResearchBatch(vaultRoot, {
      searcher,
      capturer,
      ingester: fakeIngester(),
      now: FIXED_DATE,
    });

    const outcome = result.outcomes[0] as ItemResearchOutcome;
    expect(outcome.urls).toHaveLength(2);
    expect(outcome.urls[0].status).toBe("failed");
    expect(outcome.urls[0].reason).toMatch(/network down/);
    expect(outcome.captured).toBe(1);
    expect(outcome.ingested).toBe(1);
    expect(outcome.status).toBe("resolved");
  });
});

describe("deepResearchBatch — selection and re-entrancy", () => {
  it("processes only open deep_research items, ignoring resolved ones and other actions", async () => {
    fileDeepResearchItem("already", { status: "resolved" });
    const open = fileDeepResearchItem("open");
    const searcher = fakeSearcher({ open: [{ url: "https://a.example" }] });

    const result = await deepResearchBatch(vaultRoot, {
      searcher,
      capturer: fakeCapturer(),
      ingester: fakeIngester(),
      now: FIXED_DATE,
    });

    expect(result.processed).toBe(1);
    expect(result.outcomes[0].itemId).toBe(open);
  });

  it("restricts to a single itemId when provided", async () => {
    const first = fileDeepResearchItem("q1");
    const second = fileDeepResearchItem("q2");
    const searcher = fakeSearcher({
      q1: [{ url: "https://1.example" }],
      q2: [{ url: "https://2.example" }],
    });

    const result = await deepResearchBatch(vaultRoot, {
      searcher,
      capturer: fakeCapturer(),
      ingester: fakeIngester(),
      itemId: second,
      now: FIXED_DATE,
    });

    expect(result.processed).toBe(1);
    expect(result.outcomes[0].itemId).toBe(second);
    expect(listReviewItems(vaultRoot).find((i) => i.id === first)?.status).toBe("open");
  });

  it("is re-entrant: a packet already ingested before this run still resolves the item", async () => {
    const itemId = fileDeepResearchItem("q");
    const capturer = fakeCapturer();
    const pre = await capturer.captureUrl("https://a.example");
    fs.writeFileSync(
      path.join(pre.manifest.packetDir, "manifest.json"),
      JSON.stringify({ ...pre.manifest, ingest: { status: "ingested", ingestedAt: FIXED_DATE().toISOString() } }),
    );

    const searcher = fakeSearcher({ q: [{ url: "https://a.example" }] });
    const result = await deepResearchBatch(vaultRoot, {
      searcher,
      capturer,
      ingester: fakeIngester(),
      now: FIXED_DATE,
    });

    const outcome = result.outcomes[0] as ItemResearchOutcome;
    expect(outcome.captured).toBe(0);
    expect(outcome.existed).toBe(1);
    expect(outcome.ingested).toBe(1);
    expect(outcome.status).toBe("resolved");
    expect(listReviewItems(vaultRoot).find((i) => i.id === itemId)?.status).toBe("resolved");
  });
});
