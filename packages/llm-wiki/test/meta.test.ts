import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SourcePacketManifest } from "../src/core/manifest.ts";
import { writeManifest } from "../src/core/manifest.ts";
import {
  type BacklinksDoc,
  buildBacklinks,
  type PageRegistryEntry,
  type RegistryDoc,
  rebuildMeta,
  renderIndexMd,
  renderLogMd,
} from "../src/core/meta.ts";
import { vaultLayout } from "../src/core/paths.ts";

let tmpRoot: string;
let vaultRoot: string;

const fixedNow = () => new Date(Date.UTC(2024, 0, 5, 9, 0, 0));

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-meta-"));
  vaultRoot = path.join(tmpRoot, "vault");
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeFile(rel: string, content: string): string {
  const abs = path.join(vaultRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return abs;
}

function writePage(relWikiPath: string, content: string): void {
  writeFile(path.join("wiki", relWikiPath), content);
}

function writeSourceManifest(packetId: string, manifest: SourcePacketManifest): void {
  const dir = path.join(vaultLayout(vaultRoot).sourcesRoot, packetId);
  fs.mkdirSync(dir, { recursive: true });
  writeManifest(dir, manifest);
}

function manifestFixture(id: string, overrides: Partial<SourcePacketManifest> = {}): SourcePacketManifest {
  const dir = path.join(vaultLayout(vaultRoot).sourcesRoot, id);
  const base: SourcePacketManifest = {
    schemaVersion: 1,
    id,
    packetDir: dir,
    createdAt: "2024-01-05T09:00:00.000Z",
    origin: { sourceType: "url", url: `https://example.com/${id}` },
    contentHash: "deadbeef",
    ingest: { status: "pending" },
  };
  return { ...base, ...overrides };
}

describe("rebuildMeta — writes all four derived files atomically", () => {
  it("creates registry.json, backlinks.json, index.md, log.md under meta/", () => {
    writePage("concepts/foo.md", "---\ntitle: Foo\ntype: concept\naliases: [Fooing]\n---\n# Foo\n\nSee [[bar]].\n");
    writeSourceManifest("SRC-2024-01-05-001", manifestFixture("SRC-2024-01-05-001"));

    const result = rebuildMeta(vaultRoot, { now: fixedNow });
    const layout = vaultLayout(vaultRoot);

    expect(result.pages).toBe(1);
    expect(result.sources).toBe(1);
    expect(result.written.sort()).toEqual([
      "meta/backlinks.json",
      "meta/index.md",
      "meta/log.md",
      "meta/registry.json",
    ]);

    for (const file of [layout.registry, layout.backlinks, layout.metaIndex, layout.log]) {
      expect(fs.existsSync(file)).toBe(true);
    }
  });

  it("leaves no .tmp files behind (atomic tmp+rename)", () => {
    writePage("concepts/foo.md", "# Foo\n");
    rebuildMeta(vaultRoot, { now: fixedNow });
    const metaDir = vaultLayout(vaultRoot).meta;
    const leftovers = fs.readdirSync(metaDir).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("produces valid JSON documents that parse back", () => {
    writePage("concepts/foo.md", "---\ntitle: Foo\ntype: concept\n---\n[[bar]]\n");
    rebuildMeta(vaultRoot, { now: fixedNow });
    const layout = vaultLayout(vaultRoot);
    const registry = JSON.parse(fs.readFileSync(layout.registry, "utf8")) as RegistryDoc;
    const backlinks = JSON.parse(fs.readFileSync(layout.backlinks, "utf8")) as BacklinksDoc;

    expect(registry.schemaVersion).toBe(1);
    expect(registry.vault).toBe(vaultRoot);
    expect(registry.builtAt).toBe("2024-01-05T09:00:00.000Z");
    expect(backlinks.schemaVersion).toBe(1);
  });

  it("is idempotent (rebuilding twice without changing inputs yields stable content except builtAt)", () => {
    writePage("concepts/foo.md", "---\ntitle: Foo\n---\nbody\n");
    rebuildMeta(vaultRoot, { now: fixedNow });
    const layout = vaultLayout(vaultRoot);
    const reg1 = fs.readFileSync(layout.registry, "utf8").replace(/"builtAt": "[^"]*"/, '"builtAt":"X"');

    rebuildMeta(vaultRoot, { now: () => new Date(Date.UTC(2024, 5, 1)) });
    const reg2 = fs.readFileSync(layout.registry, "utf8").replace(/"builtAt": "[^"]*"/, '"builtAt":"X"');

    expect(reg2).toBe(reg1);
  });

  it("works on an empty vault (no wiki, no sources) producing empty-but-valid artifacts", () => {
    const result = rebuildMeta(vaultRoot, { now: fixedNow });
    expect(result.pages).toBe(0);
    expect(result.sources).toBe(0);

    const layout = vaultLayout(vaultRoot);
    const registry = JSON.parse(fs.readFileSync(layout.registry, "utf8")) as RegistryDoc;
    expect(registry.pages).toEqual([]);
    expect(registry.sources).toEqual([]);
  });
});

describe("rebuildMeta — registry content", () => {
  it("derives page id, path, type, aliases, sources, links and excerpt", () => {
    writePage(
      "concepts/foo.md",
      "---\ntitle: Foo\ntype: Concept\naliases: [Fooing]\nsources: [SRC-2024-01-05-001]\n---\n# Foo\n\nFoo is a concept. It links to [[bar]].\n",
    );
    writePage("entities/bar.md", "---\ntitle: Bar\ntype: entity\n---\n# Bar\n");
    writeSourceManifest("SRC-2024-01-05-001", manifestFixture("SRC-2024-01-05-001"));

    rebuildMeta(vaultRoot, { now: fixedNow });
    const registry = JSON.parse(fs.readFileSync(vaultLayout(vaultRoot).registry, "utf8")) as RegistryDoc;

    const foo = registry.pages.find((p) => p.id === "concepts/foo");
    expect(foo).toBeDefined();
    expect(foo?.type).toBe("concept");
    expect(foo?.aliases).toEqual(["Fooing"]);
    expect(foo?.sources).toEqual(["SRC-2024-01-05-001"]);
    expect(foo?.links).toEqual(["entities/bar"]);
    expect(foo?.brokenLinks).toEqual([]);
    expect(foo?.headings).toEqual(["# Foo"]);
    expect(foo?.excerpt).toBe("Foo is a concept. It links to [[bar]].");
  });

  it("resolves plain-name links by title and aliases, case-insensitively", () => {
    writePage("concepts/foo.md", "---\ntitle: Foo\naliases: [Fooing]\n---\nlinks: [[Bar]] and [[fooing]]\n");
    writePage("entities/bar.md", "---\ntitle: Bar\n---\n");
    rebuildMeta(vaultRoot, { now: fixedNow });
    const registry = JSON.parse(fs.readFileSync(vaultLayout(vaultRoot).registry, "utf8")) as RegistryDoc;

    const foo = registry.pages.find((p) => p.id === "concepts/foo") as PageRegistryEntry;
    expect(sortUniq(foo.links)).toEqual(sortUniq(["entities/bar", "concepts/foo"]));
  });

  it("records unresolved link targets as brokenLinks", () => {
    writePage("concepts/foo.md", "---\ntitle: Foo\n---\n[[ghost]] and [[concepts/missing]]\n");
    rebuildMeta(vaultRoot, { now: fixedNow });
    const registry = JSON.parse(fs.readFileSync(vaultLayout(vaultRoot).registry, "utf8")) as RegistryDoc;
    const foo = registry.pages.find((p) => p.id === "concepts/foo") as PageRegistryEntry;
    expect(foo.brokenLinks).toEqual(["concepts/missing", "ghost"]);
    expect(foo.links).toEqual([]);
  });

  it("ignores wikilinks inside fenced code blocks when computing links", () => {
    writePage("concepts/foo.md", "---\ntitle: Foo\n---\n```\n[[fake]]\n```\n[[concepts/real-page]]\n");
    writePage("concepts/real-page.md", "---\ntitle: Real\n---\n");
    rebuildMeta(vaultRoot, { now: fixedNow });
    const registry = JSON.parse(fs.readFileSync(vaultLayout(vaultRoot).registry, "utf8")) as RegistryDoc;
    const foo = registry.pages.find((p) => p.id === "concepts/foo") as PageRegistryEntry;
    expect(foo.links).toEqual(["concepts/real-page"]);
    expect(foo.brokenLinks).toEqual([]);
  });

  it("includes the wiki overview page and nested subdirectories", () => {
    writePage("overview.md", "# Overview\n");
    writePage("syntheses/deep/nested.md", "---\ntitle: Nested\n---\n");
    rebuildMeta(vaultRoot, { now: fixedNow });
    const registry = JSON.parse(fs.readFileSync(vaultLayout(vaultRoot).registry, "utf8")) as RegistryDoc;
    const ids = registry.pages.map((p) => p.id).sort();
    expect(ids).toEqual(["overview", "syntheses/deep/nested"]);
  });

  it("summarizes each source packet from its manifest", () => {
    writeSourceManifest(
      "SRC-2024-01-05-001",
      manifestFixture("SRC-2024-01-05-001", {
        origin: { sourceType: "url", url: "https://example.com/a", title: "Alpha" },
        ingest: { status: "ingested", ingestedAt: "2024-01-06T00:00:00.000Z" },
      }),
    );
    writeSourceManifest(
      "SRC-2024-01-05-002",
      manifestFixture("SRC-2024-01-05-002", {
        origin: { sourceType: "file", originPath: "/tmp/note.md", originHash: "abc" },
      }),
    );
    rebuildMeta(vaultRoot, { now: fixedNow });
    const registry = JSON.parse(fs.readFileSync(vaultLayout(vaultRoot).registry, "utf8")) as RegistryDoc;

    expect(registry.sources.map((s) => s.id)).toEqual(["SRC-2024-01-05-001", "SRC-2024-01-05-002"]);
    const url = registry.sources.find((s) => s.id === "SRC-2024-01-05-001")!;
    expect(url.originType).toBe("url");
    expect(url.title).toBe("Alpha");
    expect(url.url).toBe("https://example.com/a");
    expect(url.ingestStatus).toBe("ingested");
    const file = registry.sources.find((s) => s.id === "SRC-2024-01-05-002")!;
    expect(file.originType).toBe("file");
    expect(file.originPath).toBe("/tmp/note.md");
    expect(file.ingestStatus).toBe("pending");
  });

  it("skips source dirs whose manifest is missing or unreadable", () => {
    writeSourceManifest("SRC-2024-01-05-001", manifestFixture("SRC-2024-01-05-001"));
    fs.mkdirSync(path.join(vaultLayout(vaultRoot).sourcesRoot, "SRC-2024-01-05-002"), { recursive: true });
    rebuildMeta(vaultRoot, { now: fixedNow });
    const registry = JSON.parse(fs.readFileSync(vaultLayout(vaultRoot).registry, "utf8")) as RegistryDoc;
    expect(registry.sources.map((s) => s.id)).toEqual(["SRC-2024-01-05-001"]);
  });
});

describe("buildBacklinks", () => {
  it("inverts forward links, dedupes, sorts, and excludes self-backlinks", () => {
    const registry: RegistryDoc = {
      schemaVersion: 1,
      builtAt: "x",
      vault: "v",
      pages: [
        {
          id: "a",
          path: "wiki/a.md",
          title: null,
          type: null,
          aliases: [],
          sources: [],
          links: ["b", "a"],
          brokenLinks: [],
          headings: [],
          excerpt: "",
          mtimeMs: null,
        },
        {
          id: "b",
          path: "wiki/b.md",
          title: null,
          type: null,
          aliases: [],
          sources: [],
          links: ["c", "a"],
          brokenLinks: [],
          headings: [],
          excerpt: "",
          mtimeMs: null,
        },
        {
          id: "c",
          path: "wiki/c.md",
          title: null,
          type: null,
          aliases: [],
          sources: [],
          links: [],
          brokenLinks: [],
          headings: [],
          excerpt: "",
          mtimeMs: null,
        },
      ],
      sources: [],
    };
    const doc = buildBacklinks(registry, { now: fixedNow });
    expect(doc.backlinks).toEqual({
      a: ["b"],
      b: ["a"],
      c: ["b"],
    });
  });

  it("omits pages with no backlinks (sparse map)", () => {
    const registry: RegistryDoc = {
      schemaVersion: 1,
      builtAt: "x",
      vault: "v",
      pages: [
        {
          id: "a",
          path: "wiki/a.md",
          title: null,
          type: null,
          aliases: [],
          sources: [],
          links: [],
          brokenLinks: [],
          headings: [],
          excerpt: "",
          mtimeMs: null,
        },
      ],
      sources: [],
    };
    const doc = buildBacklinks(registry, { now: fixedNow });
    expect(doc.backlinks).toEqual({});
  });
});

describe("renderIndexMd", () => {
  it("groups pages by type and lists sources with status", () => {
    const registry: RegistryDoc = {
      schemaVersion: 1,
      builtAt: "2024-01-05T09:00:00.000Z",
      vault: vaultRoot,
      pages: [
        {
          id: "concepts/foo",
          path: "wiki/concepts/foo.md",
          title: "Foo",
          type: "concept",
          aliases: [],
          sources: [],
          links: [],
          brokenLinks: [],
          headings: [],
          excerpt: "",
          mtimeMs: null,
        },
        {
          id: "misc/x",
          path: "wiki/misc/x.md",
          title: null,
          type: null,
          aliases: [],
          sources: [],
          links: [],
          brokenLinks: [],
          headings: [],
          excerpt: "",
          mtimeMs: null,
        },
      ],
      sources: [
        {
          id: "SRC-2024-01-05-001",
          path: "raw/sources/SRC-2024-01-05-001",
          originType: "url",
          title: "Alpha",
          url: "https://example.com/a",
          contentHash: "h",
          ingestStatus: "ingested",
          capturedAt: "2024-01-05T09:00:00.000Z",
        },
      ],
    };
    const md = renderIndexMd(registry);
    expect(md).toContain("# Wiki Index");
    expect(md).toContain("Pages: 2");
    expect(md).toContain("Sources: 1");
    expect(md).toContain("### concept (1)");
    expect(md).toContain("[[concepts/foo]] — Foo");
    expect(md).toContain("### Unclassified (1)");
    expect(md).toContain("[[misc/x]]");
    expect(md).toContain("SRC-2024-01-05-001");
    expect(md).toContain("ingested");
  });
});

describe("renderLogMd", () => {
  it("groups events by date and lists time + kind + summary", () => {
    const events = [
      { ts: "2024-01-05T08:00:00.000Z", kind: "capture", summary: "Captured SRC-1 (url)" },
      { ts: "2024-01-05T09:30:00.000Z", kind: "ingest", summary: "Ingested SRC-1" },
      { ts: "2024-01-06T10:00:00.000Z", kind: "capture", summary: "Captured SRC-2 (text)" },
    ];
    const md = renderLogMd(events);
    expect(md).toContain("# Wiki Log");
    expect(md).toContain("## 2024-01-05");
    expect(md).toContain("- 08:00:00 capture — Captured SRC-1 (url)");
    expect(md).toContain("- 09:30:00 ingest — Ingested SRC-1");
    expect(md).toContain("## 2024-01-06");
  });

  it("renders a header-only log when there are no events", () => {
    expect(renderLogMd([])).toContain("# Wiki Log");
  });

  it("is tolerant of malformed events (missing fields, unparseable)", () => {
    const events = [
      { kind: "nope" },
      { ts: "not-a-date", summary: "x" },
      "totally not an object",
      { ts: "2024-01-05T08:00:00.000Z", kind: "ok", summary: "fine" },
    ];
    const md = renderLogMd(events);
    expect(md).toContain("ok — fine");
  });

  it("rebuild renders log.md from the vault's events.jsonl", () => {
    const eventsPath = vaultLayout(vaultRoot).events;
    fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
    fs.writeFileSync(
      eventsPath,
      [
        JSON.stringify({ ts: "2024-01-05T08:00:00.000Z", kind: "capture", summary: "Captured SRC-1" }),
        JSON.stringify({ ts: "2024-01-06T10:00:00.000Z", kind: "ingest", summary: "Ingested SRC-1" }),
        "",
        "{ malformed json line",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = rebuildMeta(vaultRoot, { now: fixedNow });
    expect(result.events).toBe(2);
    const log = fs.readFileSync(vaultLayout(vaultRoot).log, "utf8");
    expect(log).toContain("## 2024-01-05");
    expect(log).toContain("- 08:00:00 capture — Captured SRC-1");
    expect(log).toContain("## 2024-01-06");
  });

  it("rebuild renders an empty log.md when events.jsonl is absent", () => {
    const result = rebuildMeta(vaultRoot, { now: fixedNow });
    expect(result.events).toBe(0);
    const log = fs.readFileSync(vaultLayout(vaultRoot).log, "utf8");
    expect(log).toContain("# Wiki Log");
  });
});

function sortUniq(arr: string[]): string[] {
  return [...new Set(arr)].sort();
}
