import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SourcePacketManifest } from "../src/core/manifest.ts";
import { writeManifest } from "../src/core/manifest.ts";
import type { BacklinksDoc, PageRegistryEntry, RegistryDoc } from "../src/core/meta.ts";
import { vaultLayout } from "../src/core/paths.ts";
import {
  expandByGraph,
  mergeVaultResults,
  type RecallHit,
  type RecallProvider,
  type RecallResult,
  recallAcross,
  recallVault,
  searchRegistry,
} from "../src/core/recall.ts";

let tmpRoot: string;
let vaultRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-recall-"));
  vaultRoot = path.join(tmpRoot, "vault");
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function page(overrides: Partial<PageRegistryEntry> & { id: string }): PageRegistryEntry {
  return {
    id: overrides.id,
    path: overrides.path ?? `wiki/${overrides.id}.md`,
    title: overrides.title ?? null,
    type: overrides.type ?? null,
    aliases: overrides.aliases ?? [],
    sources: overrides.sources ?? [],
    links: overrides.links ?? [],
    brokenLinks: overrides.brokenLinks ?? [],
    headings: overrides.headings ?? [],
    excerpt: overrides.excerpt ?? "",
    mtimeMs: overrides.mtimeMs ?? null,
  };
}

function registry(pages: PageRegistryEntry[]): RegistryDoc {
  return { schemaVersion: 1, builtAt: "x", vault: "v", pages, sources: [] };
}

function backlinks(map: Record<string, string[]>): BacklinksDoc {
  return { schemaVersion: 1, builtAt: "x", vault: "v", backlinks: map };
}

describe("searchRegistry — keyword matching", () => {
  it("matches a page by title, case-insensitively", () => {
    const reg = registry([page({ id: "concepts/react", title: "React" })]);
    const hits = searchRegistry(reg, "react");
    expect(hits.map((h) => h.id)).toEqual(["concepts/react"]);
    expect(hits[0].matchedFields).toContain("title");
  });

  it("matches by alias", () => {
    const reg = registry([page({ id: "concepts/rn", title: "React Native", aliases: ["RN"] })]);
    expect(searchRegistry(reg, "rn").map((h) => h.id)).toEqual(["concepts/rn"]);
  });

  it("matches by heading and by excerpt", () => {
    const reg = registry([
      page({ id: "concepts/a", headings: ["# Hooks API"] }),
      page({ id: "concepts/b", excerpt: "discusses react patterns" }),
    ]);
    const ids = searchRegistry(reg, "react hooks")
      .map((h) => h.id)
      .sort();
    expect(ids).toEqual(["concepts/a", "concepts/b"]);
  });

  it("matches by page id (path segment)", () => {
    const reg = registry([page({ id: "entities/openai", title: "OpenAI" })]);
    expect(searchRegistry(reg, "openai").map((h) => h.id)).toEqual(["entities/openai"]);
  });

  it("returns nothing when no page matches any token", () => {
    const reg = registry([page({ id: "concepts/a", title: "React" })]);
    expect(searchRegistry(reg, "totally unrelated")).toEqual([]);
  });

  it("ranks a title match above an excerpt match", () => {
    const reg = registry([
      page({ id: "concepts/a", title: "React", excerpt: "a library" }),
      page({ id: "concepts/b", title: "Other", excerpt: "discusses react patterns" }),
    ]);
    expect(searchRegistry(reg, "react").map((h) => h.id)).toEqual(["concepts/a", "concepts/b"]);
  });

  it("a page matching more query tokens ranks above one matching fewer", () => {
    const reg = registry([
      page({ id: "concepts/full", title: "React Hooks" }),
      page({ id: "concepts/partial", title: "React", excerpt: "general stuff" }),
    ]);
    expect(searchRegistry(reg, "react hooks")[0].id).toBe("concepts/full");
  });

  it("reports which fields matched (deduped, stable order)", () => {
    const reg = registry([
      page({
        id: "concepts/react",
        title: "React",
        aliases: ["ReactJS"],
        headings: ["# React Overview"],
        excerpt: "react is a ui library",
      }),
    ]);
    const hit = searchRegistry(reg, "react")[0];
    expect(hit.matchedFields).toEqual(["title", "alias", "heading", "id", "excerpt"]);
  });

  it("sorts hits by score descending", () => {
    const reg = registry([
      page({ id: "concepts/low", excerpt: "react mentioned here" }),
      page({ id: "concepts/high", title: "React" }),
      page({ id: "concepts/mid", aliases: ["React"] }),
    ]);
    expect(searchRegistry(reg, "react").map((h) => h.id)).toEqual(["concepts/high", "concepts/mid", "concepts/low"]);
  });

  it("returns an empty array for a blank query", () => {
    const reg = registry([page({ id: "concepts/a", title: "React" })]);
    expect(searchRegistry(reg, "   ")).toEqual([]);
  });

  it("ignores punctuation when tokenizing", () => {
    const reg = registry([page({ id: "concepts/a", title: "React" })]);
    expect(searchRegistry(reg, "react!").map((h) => h.id)).toEqual(["concepts/a"]);
  });
});

describe("expandByGraph — four-signal relevance", () => {
  it("returns no candidates when seeds have no graph neighbours", () => {
    const reg = registry([page({ id: "concepts/seed", links: [] })]);
    const hits = expandByGraph(["concepts/seed"], reg, backlinks({}));
    expect(hits).toEqual([]);
  });

  it("excludes the seeds themselves from the expansion", () => {
    const reg = registry([
      page({ id: "concepts/a", links: ["concepts/b"] }),
      page({ id: "concepts/b", links: ["concepts/a"] }),
    ]);
    const hits = expandByGraph(["concepts/a"], reg, backlinks({ "concepts/a": ["concepts/b"] }));
    expect(hits.map((h) => h.id)).toEqual(["concepts/b"]);
  });

  it("direct-link signal: counts forward and backward neighbours (x3)", () => {
    const reg = registry([
      page({ id: "concepts/seed", links: ["concepts/fwd"] }),
      page({ id: "concepts/fwd", links: [] }),
      page({ id: "concepts/back", links: ["concepts/seed"] }),
    ]);
    const byId = new Map(
      expandByGraph(["concepts/seed"], reg, backlinks({ "concepts/seed": ["concepts/back"] })).map(
        (h) => [h.id, h] as const,
      ),
    );
    expect(byId.get("concepts/fwd")?.signals.direct).toBe(3);
    expect(byId.get("concepts/back")?.signals.direct).toBe(3);
  });

  it("source-overlap signal: shared frontmatter sources[] (x4)", () => {
    const reg = registry([
      page({ id: "concepts/seed", sources: ["SRC-1", "SRC-2"] }),
      page({ id: "concepts/share1", sources: ["SRC-1"] }),
      page({ id: "concepts/share2", sources: ["SRC-1", "SRC-2"] }),
      page({ id: "concepts/noshare", sources: ["SRC-3"] }),
    ]);
    const hits = new Map(expandByGraph(["concepts/seed"], reg, backlinks({})).map((h) => [h.id, h] as const));
    expect(hits.has("concepts/noshare")).toBe(false);
    expect(hits.get("concepts/share1")?.signals.source).toBe(4);
    expect(hits.get("concepts/share2")?.signals.source).toBe(8);
  });

  it("adamic-adar signal: rewards rare common neighbours over popular ones (x1.5)", () => {
    const reg = registry([
      page({ id: "concepts/seed", links: ["concepts/rare", "concepts/hub"] }),
      page({ id: "concepts/cand", links: ["concepts/rare", "concepts/hub"] }),
      page({ id: "concepts/rare", links: ["concepts/seed", "concepts/cand"] }),
      page({ id: "concepts/hub", links: [] }),
    ]);
    const bl = backlinks({
      "concepts/hub": ["concepts/seed", "concepts/cand", "concepts/other1", "concepts/other2"],
      "concepts/rare": ["concepts/seed", "concepts/cand"],
    });
    const hit = new Map(expandByGraph(["concepts/seed"], reg, bl).map((h) => [h.id, h] as const)).get("concepts/cand");
    expect(hit).toBeDefined();
    expect(hit!.signals.adamicAdar ?? 0).toBeGreaterThan(0);
    expect(hit!.viaSeeds).toContain("concepts/seed");
  });

  it("type-affinity signal: +1 when candidate type matches a seed type", () => {
    const reg = registry([
      page({ id: "concepts/seed", type: "concept", sources: ["SRC-1"] }),
      page({ id: "concepts/sametype", type: "concept", sources: ["SRC-1"] }),
      page({ id: "entities/othertype", type: "entity", sources: ["SRC-1"] }),
    ]);
    const hits = new Map(expandByGraph(["concepts/seed"], reg, backlinks({})).map((h) => [h.id, h] as const));
    expect(hits.get("concepts/sametype")?.signals.type).toBe(1);
    expect(hits.get("entities/othertype")?.signals.type).toBe(0);
  });

  it("aggregates signals across multiple seeds (union of neighbours, shared sources counted once)", () => {
    const reg = registry([
      page({ id: "concepts/seed1", type: "concept", sources: ["SRC-1"] }),
      page({ id: "concepts/seed2", type: "concept", sources: ["SRC-2"] }),
      page({ id: "concepts/cand", type: "concept", sources: ["SRC-1", "SRC-2"] }),
    ]);
    const hit = new Map(
      expandByGraph(["concepts/seed1", "concepts/seed2"], reg, backlinks({})).map((h) => [h.id, h] as const),
    ).get("concepts/cand");
    expect(hit?.signals.source).toBe(8);
    expect(hit?.signals.type).toBe(1);
    expect(hit?.viaSeeds.sort()).toEqual(["concepts/seed1", "concepts/seed2"]);
  });

  it("only returns candidates with a non-zero aggregate score", () => {
    const reg = registry([
      page({ id: "concepts/seed", type: "concept" }),
      page({ id: "concepts/unrelated", type: "entity", links: [], sources: [] }),
    ]);
    const hits = expandByGraph(["concepts/seed"], reg, backlinks({}));
    expect(hits.map((h) => h.id)).not.toContain("concepts/unrelated");
  });

  it("respects the seed-multiplier weight product (direct=3, source=4, adamic=1.5, type=1) for a single candidate", () => {
    const reg = registry([
      page({ id: "concepts/seed", type: "concept", sources: ["SRC-1"], links: ["concepts/cand"] }),
      page({ id: "concepts/cand", type: "concept", sources: ["SRC-1"], links: ["concepts/seed"] }),
      page({ id: "concepts/mid", links: ["concepts/seed", "concepts/cand"] }),
    ]);
    const bl = backlinks({
      "concepts/seed": ["concepts/cand", "concepts/mid"],
      "concepts/cand": ["concepts/seed", "concepts/mid"],
    });
    const hit = new Map(expandByGraph(["concepts/seed"], reg, bl).map((h) => [h.id, h] as const)).get("concepts/cand");
    expect(hit?.signals.direct).toBe(3);
    expect(hit?.signals.source).toBe(4);
    expect(hit?.signals.type).toBe(1);
    expect(hit?.score).toBe(
      hit!.signals.direct + hit!.signals.source + (hit!.signals.adamicAdar ?? 0) + hit!.signals.type,
    );
  });
});

describe("recallVault — end-to-end on one vault", () => {
  function writePage(relWikiPath: string, content: string): void {
    const abs = path.join(vaultRoot, "wiki", `${relWikiPath}.md`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }

  function writeSourceManifest(packetId: string, manifest: SourcePacketManifest): void {
    const dir = path.join(vaultLayout(vaultRoot).sourcesRoot, packetId);
    fs.mkdirSync(dir, { recursive: true });
    writeManifest(dir, manifest);
  }

  function manifestFixture(id: string): SourcePacketManifest {
    return {
      schemaVersion: 1,
      id,
      packetDir: path.join(vaultLayout(vaultRoot).sourcesRoot, id),
      createdAt: "2024-01-05T09:00:00.000Z",
      origin: { sourceType: "url", url: `https://example.com/${id}` },
      contentHash: "deadbeef",
      ingest: { status: "pending" },
    };
  }

  it("merges keyword hits and graph candidates into one ranked list", () => {
    writePage(
      "concepts/react",
      "---\ntitle: React\ntype: concept\nsources: [SRC-1]\n---\n# React\n\nSee [[concepts/hooks]].\n",
    );
    writePage("concepts/hooks", "---\ntitle: Hooks\ntype: concept\nsources: [SRC-1]\n---\n# Hooks\n");
    writePage("entities/unrelated", "---\ntitle: Boring\ntype: entity\n---\n# Boring\n");
    writeSourceManifest("SRC-1", manifestFixture("SRC-1"));

    const result = recallVault(vaultRoot, "react");
    const ids = result.hits.map((h) => h.id);
    expect(ids).toContain("concepts/react");
    expect(ids).toContain("concepts/hooks");
    expect(ids).not.toContain("entities/unrelated");

    const react = result.hits.find((h) => h.id === "concepts/react")!;
    expect(react.matchedBy).toContain("keyword");
    const hooks = result.hits.find((h) => h.id === "concepts/hooks")!;
    expect(hooks.matchedBy).toContain("graph");
    expect(hooks.signals?.source).toBeGreaterThan(0);
  });

  it("a page that is both a keyword hit and a graph candidate is flagged with both", () => {
    writePage(
      "concepts/a",
      "---\ntitle: Alpha\ntype: concept\nsources: [SRC-1]\n---\n# Alpha\n\nLinks [[concepts/b]].\n",
    );
    writePage(
      "concepts/b",
      "---\ntitle: Beta\ntype: concept\nsources: [SRC-1]\n---\n# Beta\n\nMentions alpha and more alpha.\n",
    );
    writeSourceManifest("SRC-1", manifestFixture("SRC-1"));

    const result = recallVault(vaultRoot, "alpha");
    const b = result.hits.find((h) => h.id === "concepts/b");
    expect(b?.matchedBy).toEqual(expect.arrayContaining(["keyword", "graph"]));
  });

  it("returns the vault root, path, excerpt and sources on each hit", () => {
    writePage("concepts/react", "---\ntitle: React\ntype: concept\nsources: [SRC-1]\n---\n# React\n\nA UI library.\n");
    writeSourceManifest("SRC-1", manifestFixture("SRC-1"));

    const hit = recallVault(vaultRoot, "react").hits[0]!;
    expect(hit.vault).toBe(vaultRoot);
    expect(hit.path).toContain("concepts/react");
    expect(hit.title).toBe("React");
    expect(hit.type).toBe("concept");
    expect(hit.excerpt).toContain("A UI library");
    expect(hit.sources).toEqual(["SRC-1"]);
  });

  it("respects a limit cap on the returned hits", () => {
    writePage("concepts/a", "---\ntitle: React A\n---\n");
    writePage("concepts/b", "---\ntitle: React B\n---\n");
    writePage("concepts/c", "---\ntitle: React C\n---\n");

    const result = recallVault(vaultRoot, "react", { limit: 2 });
    expect(result.hits).toHaveLength(2);
  });

  it("returns empty hits for a blank query", () => {
    writePage("concepts/react", "---\ntitle: React\n---\n");
    expect(recallVault(vaultRoot, "   ").hits).toEqual([]);
  });
});

describe("mergeVaultResults — cross-vault dedup", () => {
  function recallResult(vault: string, hits: Array<{ id: string; score: number; matchedBy: string[] }>): RecallResult {
    return {
      query: "x",
      vaults: [vault],
      hits: hits.map((h) => ({
        vault,
        id: h.id,
        path: `wiki/${h.id}.md`,
        title: null,
        type: null,
        excerpt: "",
        sources: [],
        score: h.score,
        matchedBy: h.matchedBy as Array<"keyword" | "graph">,
      })),
    };
  }

  it("dedups by page id, keeping the highest-scoring vault as primary and listing all vaults", () => {
    const merged = mergeVaultResults([
      recallResult("/proj", [{ id: "concepts/react", score: 5, matchedBy: ["keyword"] }]),
      recallResult("/home", [{ id: "concepts/react", score: 12, matchedBy: ["keyword", "graph"] }]),
    ]);

    expect(merged.hits).toHaveLength(1);
    const hit = merged.hits[0]!;
    expect(hit.id).toBe("concepts/react");
    expect(hit.vault).toBe("/home");
    expect(hit.vaults?.sort()).toEqual(["/home", "/proj"]);
    expect(hit.score).toBe(12);
    expect(hit.matchedBy.sort()).toEqual(["graph", "keyword"]);
  });

  it("keeps distinct ids as separate entries (no over-merging)", () => {
    const merged = mergeVaultResults([
      recallResult("/proj", [{ id: "concepts/a", score: 3, matchedBy: ["keyword"] }]),
      recallResult("/home", [{ id: "concepts/b", score: 4, matchedBy: ["graph"] }]),
    ]);
    expect(merged.hits.map((h) => h.id).sort()).toEqual(["concepts/a", "concepts/b"]);
  });

  it("sorts the merged list by score descending", () => {
    const merged = mergeVaultResults([
      recallResult("/proj", [
        { id: "concepts/low", score: 1, matchedBy: ["keyword"] },
        { id: "concepts/high", score: 9, matchedBy: ["keyword"] },
      ]),
      recallResult("/home", [{ id: "concepts/mid", score: 5, matchedBy: ["graph"] }]),
    ]);
    expect(merged.hits.map((h) => h.score)).toEqual([9, 5, 1]);
  });

  it("unions the vaults scanned across all inputs", () => {
    const merged = mergeVaultResults([
      recallResult("/proj", [{ id: "concepts/a", score: 1, matchedBy: ["keyword"] }]),
      recallResult("/home", [{ id: "concepts/b", score: 1, matchedBy: ["keyword"] }]),
    ]);
    expect(merged.vaults.sort()).toEqual(["/home", "/proj"]);
  });
});

describe("recallAcross — recall-provider seam", () => {
  function writePage(relWikiPath: string, content: string): void {
    const abs = path.join(vaultRoot, "wiki", `${relWikiPath}.md`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }

  function providerHit(id: string, score: number, vault = "/vector"): RecallHit {
    return {
      vault,
      id,
      path: `wiki/${id}.md`,
      title: null,
      type: null,
      excerpt: "",
      sources: [],
      score,
      matchedBy: [],
    };
  }

  it("falls back to local registry+graph recall when no provider is given", async () => {
    writePage("concepts/react", "---\ntitle: React\ntype: concept\n---\n# React\n");
    const result = await recallAcross([vaultRoot], "react");
    expect(result.hits.map((h) => h.id)).toEqual(["concepts/react"]);
    expect(result.hits[0]!.matchedBy).toContain("keyword");
  });

  it("merges provider hits in, tagging them as 'vector', and unions vaults", async () => {
    writePage("concepts/react", "---\ntitle: React\ntype: concept\n---\n# React\n");
    const provider: RecallProvider = {
      async recall() {
        return [providerHit("concepts/react", 50), providerHit("concepts/vector-only", 7)];
      },
    };
    const result = await recallAcross([vaultRoot], "react", { provider });
    const ids = result.hits.map((h) => h.id).sort();
    expect(ids).toEqual(["concepts/react", "concepts/vector-only"]);

    const react = result.hits.find((h) => h.id === "concepts/react")!;
    expect(react.matchedBy).toContain("vector");
    expect(react.matchedBy).toContain("keyword");
    expect(react.score).toBe(50);
    expect(result.vaults).toContain("/vector");
  });
});

describe("recallAcross — merged-set limit", () => {
  function writePage(root: string, relWikiPath: string, content: string): void {
    const abs = path.join(root, "wiki", `${relWikiPath}.md`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }

  it("caps the merged cross-vault set to `limit`, not per vault", async () => {
    const secondVault = path.join(tmpRoot, "second-vault");
    writePage(vaultRoot, "concepts/react-a", "---\ntitle: React A\ntype: concept\n---\n# React A\n");
    writePage(vaultRoot, "concepts/react-b", "---\ntitle: React B\ntype: concept\n---\n# React B\n");
    writePage(secondVault, "concepts/react-c", "---\ntitle: React C\ntype: concept\n---\n# React C\n");
    writePage(secondVault, "concepts/react-d", "---\ntitle: React D\ntype: concept\n---\n# React D\n");

    const result = await recallAcross([vaultRoot, secondVault], "react", { limit: 2 });
    expect(result.hits).toHaveLength(2);
    expect(result.vaults.sort()).toEqual([secondVault, vaultRoot].sort());
  });
});
