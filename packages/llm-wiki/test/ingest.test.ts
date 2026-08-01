import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapVault } from "../src/core/bootstrap.ts";
import { type IngestBatchResult, ingestBatch, type SideCaller } from "../src/core/ingest.ts";
import { readManifest } from "../src/core/manifest.ts";
import { captureSource } from "../src/core/packet.ts";
import { vaultLayout } from "../src/core/paths.ts";
import { appendReviewItem, listReviewItems } from "../src/core/review.ts";

let tmpRoot: string;
let vaultRoot: string;

const FIXED_DATE = () => new Date(Date.UTC(2024, 0, 5, 9, 0, 0));

const ANALYSIS_TEXT = [
  "```wiki-analysis",
  JSON.stringify({
    summary: "The source introduces concept Foo.",
    entities: [],
    concepts: [{ title: "Foo", note: "central idea" }],
    syntheses: [],
    contradictions: [],
    links: [],
    review: [{ kind: "coverage_gap", title: "Need Foo examples", action: "deep_research", query: "Foo examples" }],
  }),
  "```",
].join("\n");

const GENERATION_TEXT = [
  "```wiki-page:source",
  "---",
  "type: source",
  "title: The Foo Paper",
  "sources: [SRC-2024-01-05-001]",
  "---",
  "# The Foo Paper",
  "",
  "Introduces Foo. See [[sources/SRC-2024-01-05-001]].",
  "```",
  "```wiki-page:concept",
  "---",
  "type: concept",
  "title: Foo",
  "sources: [SRC-2024-01-05-001]",
  "---",
  "# Foo",
  "",
  "The central idea.",
  "```",
].join("\n");

function fakeCaller(analysis: string, generation: string): SideCaller {
  return {
    async call(input) {
      if (input.systemPrompt.includes("STEP: analysis")) return { ok: true, text: analysis };
      if (input.systemPrompt.includes("STEP: generation")) return { ok: true, text: generation };
      return { ok: false, error: "unknown step" };
    },
  };
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-ingest-"));
  vaultRoot = path.join(tmpRoot, "vault");
  bootstrapVault(vaultRoot, { now: FIXED_DATE });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function captureTextSource(body: string): Promise<string> {
  const result = await captureSource(
    { sourceType: "text", text: body, title: "The Foo Paper" },
    { sourcesDir: vaultLayout(vaultRoot).sourcesRoot, now: FIXED_DATE },
  );
  return result.manifest.id;
}

describe("ingestBatch — happy path", () => {
  it("ingests a pending packet: pages, review items, manifest, and metadata all land", async () => {
    const packetId = await captureTextSource("# Foo\n\nFoo is a thing.");
    const caller = fakeCaller(ANALYSIS_TEXT, GENERATION_TEXT);

    const result = await ingestBatch(vaultRoot, { caller, now: FIXED_DATE });

    expect(result.processed).toBe(1);
    expect(result.ingested).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.outcomes[0].packetId).toBe(packetId);

    const sourcePage = path.join(vaultRoot, "wiki", "sources", "the-foo-paper.md");
    expect(fs.existsSync(sourcePage)).toBe(true);
    const sourceBody = fs.readFileSync(sourcePage, "utf8");
    expect(sourceBody).toContain("[[sources/SRC-2024-01-05-001]]");
    expect(sourceBody).toContain("# The Foo Paper");

    const conceptPage = path.join(vaultRoot, "wiki", "concepts", "foo.md");
    expect(fs.existsSync(conceptPage)).toBe(true);
    expect(fs.readFileSync(conceptPage, "utf8")).toContain("# Foo");

    const review = listReviewItems(vaultRoot);
    expect(review).toHaveLength(1);
    expect(review[0].kind).toBe("coverage_gap");
    expect(review[0].action).toBe("deep_research");
    expect(review[0].packetId).toBe(packetId);

    const manifest = readManifest(path.join(vaultLayout(vaultRoot).sourcesRoot, packetId));
    expect(manifest.ingest.status).toBe("ingested");
    expect(manifest.ingest.ingestedAt).toBe(FIXED_DATE().toISOString());

    const registry = JSON.parse(fs.readFileSync(path.join(vaultRoot, "meta", "registry.json"), "utf8")) as {
      pages: { id: string }[];
      sources: { id: string; ingestStatus: string }[];
    };
    const pageIds = registry.pages.map((p) => p.id).sort();
    expect(pageIds).toEqual(["concepts/foo", "overview", "sources/the-foo-paper"].sort());
    expect(registry.sources[0].ingestStatus).toBe("ingested");
  });

  it("captures an overview when the generation emits a wiki-overview fence", async () => {
    await captureTextSource("# Foo");
    const generation = `${GENERATION_TEXT}\n\`\`\`wiki-overview\n# Wiki Overview\n\n- one source\n\`\`\``;
    const caller = fakeCaller(ANALYSIS_TEXT, generation);

    await ingestBatch(vaultRoot, { caller, now: FIXED_DATE });

    const overview = fs.readFileSync(vaultLayout(vaultRoot).wikiOverview, "utf8");
    expect(overview).toContain("# Wiki Overview");
    expect(overview).toContain("- one source");
  });
});

describe("ingestBatch — re-entrancy", () => {
  it("skips already-ingested packets on a second run (nothing pending)", async () => {
    await captureTextSource("# Foo");
    const caller = fakeCaller(ANALYSIS_TEXT, GENERATION_TEXT);

    await ingestBatch(vaultRoot, { caller, now: FIXED_DATE });
    const second = await ingestBatch(vaultRoot, { caller, now: FIXED_DATE });

    expect(second.processed).toBe(0);
    expect(second.ingested).toBe(0);
    expect(second.skipped).toBe(0);
  });

  it("does not duplicate pages when a packet is re-ingested after a failure", async () => {
    const packetId = await captureTextSource("# Foo");
    let calls = 0;
    const caller: SideCaller = {
      async call(input) {
        calls += 1;
        if (input.systemPrompt.includes("STEP: analysis")) return { ok: true, text: ANALYSIS_TEXT };
        if (input.systemPrompt.includes("STEP: generation")) {
          if (calls < 3) return { ok: false, error: "transient" };
          return { ok: true, text: GENERATION_TEXT };
        }
        return { ok: false, error: "unknown" };
      },
    };

    const first = await ingestBatch(vaultRoot, { caller, now: FIXED_DATE });
    expect(first.failed).toBe(1);
    expect(readManifest(path.join(vaultLayout(vaultRoot).sourcesRoot, packetId)).ingest.status).toBe("pending");
    expect(fs.existsSync(path.join(vaultRoot, "wiki", "sources", "the-foo-paper.md"))).toBe(false);

    const second = await ingestBatch(vaultRoot, { caller, now: FIXED_DATE });
    expect(second.ingested).toBe(1);

    const sourcePages = fs.readdirSync(path.join(vaultRoot, "wiki", "sources"));
    expect(sourcePages).toEqual(["the-foo-paper.md"]);
  });
});

describe("ingestBatch — failure handling", () => {
  it("leaves the manifest pending and reports failed when analysis is unparseable", async () => {
    const packetId = await captureTextSource("# Foo");
    const caller = fakeCaller("no fence here", GENERATION_TEXT);

    const result = await ingestBatch(vaultRoot, { caller, now: FIXED_DATE });

    expect(result.failed).toBe(1);
    expect(result.outcomes[0].status).toBe("failed");
    expect(result.outcomes[0].reason).toMatch(/analysis/i);
    const manifest = readManifest(path.join(vaultLayout(vaultRoot).sourcesRoot, packetId));
    expect(manifest.ingest.status).toBe("pending");
  });

  it("fails when generation produces no source page", async () => {
    await captureTextSource("# Foo");
    const generationNoSource = [
      "```wiki-page:concept",
      "---",
      "type: concept",
      "title: Foo",
      "---",
      "# Foo",
      "```",
    ].join("\n");
    const caller = fakeCaller(ANALYSIS_TEXT, generationNoSource);

    const result: IngestBatchResult = await ingestBatch(vaultRoot, { caller, now: FIXED_DATE });
    expect(result.failed).toBe(1);
    expect(result.outcomes[0].reason).toMatch(/source page/i);
  });

  it("continues to the next packet after a failure", async () => {
    await captureTextSource("# First");
    await captureSource(
      { sourceType: "text", text: "# Second", title: "Second" },
      { sourcesDir: vaultLayout(vaultRoot).sourcesRoot, now: () => new Date(Date.UTC(2024, 0, 6, 9, 0, 0)) },
    );

    let analysisCalls = 0;
    const caller: SideCaller = {
      async call(input) {
        if (input.systemPrompt.includes("STEP: analysis")) {
          analysisCalls += 1;
          if (analysisCalls === 1) return { ok: false, error: "boom" };
          return { ok: true, text: ANALYSIS_TEXT };
        }
        return { ok: true, text: GENERATION_TEXT };
      },
    };

    const result = await ingestBatch(vaultRoot, { caller, now: FIXED_DATE });
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.ingested).toBe(1);
  });
});

describe("ingestBatch — packetId filter", () => {
  it("ingests only the named packet when packetId is given", async () => {
    await captureTextSource("# First");
    const secondResult = await captureSource(
      { sourceType: "text", text: "# Second", title: "Second" },
      { sourcesDir: vaultLayout(vaultRoot).sourcesRoot, now: () => new Date(Date.UTC(2024, 0, 6, 9, 0, 0)) },
    );
    const second = secondResult.manifest.id;
    const caller = fakeCaller(ANALYSIS_TEXT, GENERATION_TEXT);

    const result = await ingestBatch(vaultRoot, { caller, now: FIXED_DATE, packetId: second });
    expect(result.processed).toBe(1);
    expect(result.outcomes[0].packetId).toBe(second);
  });
});

describe("ingestBatch — updating existing related pages", () => {
  it("unions the packet into an existing page's sources without rewriting its body", async () => {
    const conceptPath = path.join(vaultRoot, "wiki", "concepts", "foo.md");
    fs.mkdirSync(path.dirname(conceptPath), { recursive: true });
    fs.writeFileSync(
      conceptPath,
      "---\ntype: concept\ntitle: Foo\naliases: []\nsources: [SRC-PRE-EXISTING]\n---\n# Foo\n\nHand-authored body.\n",
      "utf8",
    );

    const packetId = await captureTextSource("# Foo");
    const caller = fakeCaller(ANALYSIS_TEXT, GENERATION_TEXT);

    const result = await ingestBatch(vaultRoot, { caller, now: FIXED_DATE });
    expect(result.ingested).toBe(1);

    const body = fs.readFileSync(conceptPath, "utf8");
    expect(body).toContain("Hand-authored body.");
    expect(body).not.toContain("The central idea.");
    const fm = body.split("---")[1] ?? "";
    expect(fm).toContain("SRC-PRE-EXISTING");
    expect(fm).toContain(packetId);
  });
});

describe("ingestBatch — overview maintenance", () => {
  it("creates overview.md with a per-source line when the model omits the overview fence", async () => {
    const packetId = await captureTextSource("# Foo");
    const generation = [
      "```wiki-page:source",
      "---",
      "type: source",
      "title: The Foo Paper",
      "sources: [SRC-2024-01-05-001]",
      "---",
      "# The Foo Paper",
      "",
      "See [[sources/SRC-2024-01-05-001]].",
      "```",
    ].join("\n");
    const caller = fakeCaller(ANALYSIS_TEXT, generation);

    await ingestBatch(vaultRoot, { caller, now: FIXED_DATE });

    const overview = fs.readFileSync(vaultLayout(vaultRoot).wikiOverview, "utf8");
    expect(overview).toContain(`[[sources/${packetId}]]`);
  });
});

describe("ingestBatch — review queue re-entrancy", () => {
  it("does not duplicate review items filed by a prior partial run for the same packet", async () => {
    const packetId = await captureTextSource("# Foo");
    appendReviewItem(
      vaultRoot,
      { packetId, kind: "coverage_gap", title: "Need Foo examples", action: "deep_research", query: "Foo examples" },
      { now: FIXED_DATE },
    );
    const caller = fakeCaller(ANALYSIS_TEXT, GENERATION_TEXT);

    await ingestBatch(vaultRoot, { caller, now: FIXED_DATE });

    const forPacket = listReviewItems(vaultRoot).filter((r) => r.packetId === packetId);
    expect(forPacket).toHaveLength(1);
  });
});
