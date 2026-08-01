import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AppendReviewInput,
  appendReviewItem,
  listReviewItems,
  REVIEW_SCHEMA_VERSION,
  type ReviewAction,
  type ReviewItem,
  resolveReviewItem,
} from "../src/core/review.ts";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-review-"));
  fs.mkdirSync(path.join(tmpRoot, "meta"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const FIXED_NOW = new Date(Date.UTC(2024, 0, 5, 9, 30, 0));

function baseInput(overrides: Partial<AppendReviewInput> = {}): AppendReviewInput {
  return {
    packetId: "SRC-2024-01-05-001",
    kind: "contradiction",
    title: "React Server Components vs client-first",
    action: "create_page",
    ...overrides,
  };
}

describe("appendReviewItem", () => {
  it("appends a JSONL line with an auto-allocated id, filedAt, and status=open", () => {
    const item = appendReviewItem(tmpRoot, baseInput(), { now: FIXED_NOW });

    expect(item.status).toBe("open");
    expect(item.filedAt).toBe(FIXED_NOW.toISOString());
    expect(item.id).toMatch(/^REV-\d{8}T\d{6}-[0-9a-z]{4}$/);
    expect(item.packetId).toBe("SRC-2024-01-05-001");

    const onDisk = fs.readFileSync(path.join(tmpRoot, "meta", "review.jsonl"), "utf8").trim();
    const parsed = JSON.parse(onDisk) as ReviewItem;
    expect(parsed).toEqual(item);
    expect(parsed.schemaVersion).toBe(REVIEW_SCHEMA_VERSION);
  });

  it("preserves optional note and query fields when provided", () => {
    const item = appendReviewItem(tmpRoot, baseInput({ note: "see claim 3", query: "RSC data fetching" }), {
      now: FIXED_NOW,
    });

    expect(item.note).toBe("see claim 3");
    expect(item.query).toBe("RSC data fetching");
  });

  it("omits optional note and query fields when absent", () => {
    const item = appendReviewItem(tmpRoot, baseInput(), { now: FIXED_NOW });
    expect(item).not.toHaveProperty("note");
    expect(item).not.toHaveProperty("query");
  });

  it("appends multiple items as separate JSONL lines", () => {
    appendReviewItem(tmpRoot, baseInput({ title: "first" }), { now: FIXED_NOW });
    appendReviewItem(tmpRoot, baseInput({ title: "second" }), { now: FIXED_NOW });

    const lines = fs
      .readFileSync(path.join(tmpRoot, "meta", "review.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(2);
    const ids = lines.map((l) => (JSON.parse(l) as ReviewItem).id);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe("listReviewItems", () => {
  it("round-trips appended items in file order", () => {
    const a = appendReviewItem(tmpRoot, baseInput({ title: "first" }), { now: FIXED_NOW });
    const b = appendReviewItem(tmpRoot, baseInput({ action: "deep_research", title: "second", query: "q" }), {
      now: FIXED_NOW,
    });

    const items = listReviewItems(tmpRoot);
    expect(items).toEqual([a, b]);
    expect(items[1].action).toBe("deep_research");
    expect(items[1].query).toBe("q");
  });

  it("returns an empty array when the review file does not exist", () => {
    fs.rmSync(path.join(tmpRoot, "meta", "review.jsonl"), { force: true });
    expect(listReviewItems(tmpRoot)).toEqual([]);
  });

  it("skips malformed lines and keeps the valid ones", () => {
    appendReviewItem(tmpRoot, baseInput({ title: "valid" }), { now: FIXED_NOW });
    fs.appendFileSync(path.join(tmpRoot, "meta", "review.jsonl"), "this is not json\n\n", "utf8");

    const items = listReviewItems(tmpRoot);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("valid");
  });

  it("filters by status when a filter is given (default returns all)", () => {
    const a = appendReviewItem(tmpRoot, baseInput({ title: "a" }), { now: FIXED_NOW });
    const b = appendReviewItem(tmpRoot, baseInput({ title: "b" }), { now: FIXED_NOW });
    resolveReviewItem(tmpRoot, a.id, "skip", { now: FIXED_NOW });

    expect(listReviewItems(tmpRoot).map((i) => i.id)).toEqual([a.id, b.id]);
    expect(listReviewItems(tmpRoot, { status: "all" }).map((i) => i.id)).toEqual([a.id, b.id]);
    expect(listReviewItems(tmpRoot, { status: "open" }).map((i) => i.id)).toEqual([b.id]);
    expect(listReviewItems(tmpRoot, { status: "resolved" }).map((i) => i.id)).toEqual([a.id]);
  });
});

describe("resolveReviewItem", () => {
  it("marks the item resolved with the chosen action, timestamp, and resolutionNote", () => {
    const filed = appendReviewItem(tmpRoot, baseInput(), { now: FIXED_NOW });
    const resolved = resolveReviewItem(tmpRoot, filed.id, "create_page", {
      now: () => new Date(Date.UTC(2024, 0, 7, 12, 0, 0)),
      note: "created concepts/x.md",
    });

    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedAction).toBe("create_page");
    expect(resolved.resolvedAt).toBe("2024-01-07T12:00:00.000Z");
    expect(resolved.resolutionNote).toBe("created concepts/x.md");
    expect(resolved.action).toBe("create_page");

    expect(listReviewItems(tmpRoot, { status: "open" })).toEqual([]);
  });

  it("accepts all three constrained actions", () => {
    const a = appendReviewItem(tmpRoot, baseInput({ title: "a" }), { now: FIXED_NOW });
    const b = appendReviewItem(tmpRoot, baseInput({ title: "b" }), { now: FIXED_NOW });
    const c = appendReviewItem(tmpRoot, baseInput({ title: "c" }), { now: FIXED_NOW });

    resolveReviewItem(tmpRoot, a.id, "create_page", { now: FIXED_NOW });
    resolveReviewItem(tmpRoot, b.id, "deep_research", { now: FIXED_NOW });
    resolveReviewItem(tmpRoot, c.id, "skip", { now: FIXED_NOW });

    const actions = listReviewItems(tmpRoot, { status: "resolved" }).map((i) => i.resolvedAction);
    expect(actions).toEqual(["create_page", "deep_research", "skip"]);
  });

  it("rewrites atomically (no .tmp leftovers) and preserves the other entries", () => {
    const a = appendReviewItem(tmpRoot, baseInput({ title: "a" }), { now: FIXED_NOW });
    appendReviewItem(tmpRoot, baseInput({ title: "b" }), { now: FIXED_NOW });
    resolveReviewItem(tmpRoot, a.id, "skip", { now: FIXED_NOW });

    const metaDir = path.join(tmpRoot, "meta");
    expect(fs.readdirSync(metaDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(listReviewItems(tmpRoot, { status: "all" })).toHaveLength(2);
  });

  it("throws when the item id does not exist", () => {
    expect(() => resolveReviewItem(tmpRoot, "REV-does-not-exist", "skip", { now: FIXED_NOW })).toThrow(/not found/i);
  });

  it("throws when the item is already resolved", () => {
    const filed = appendReviewItem(tmpRoot, baseInput(), { now: FIXED_NOW });
    resolveReviewItem(tmpRoot, filed.id, "skip", { now: FIXED_NOW });
    expect(() => resolveReviewItem(tmpRoot, filed.id, "skip", { now: FIXED_NOW })).toThrow(/already resolved/i);
  });

  it("throws on an invalid action (prevents hallucinated actions)", () => {
    const filed = appendReviewItem(tmpRoot, baseInput(), { now: FIXED_NOW });
    expect(() => resolveReviewItem(tmpRoot, filed.id, "delete_everything" as ReviewAction, { now: FIXED_NOW })).toThrow(
      /action/i,
    );
  });
});
