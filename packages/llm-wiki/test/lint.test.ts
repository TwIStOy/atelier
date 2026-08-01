import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contentHash } from "../src/core/atomic.ts";
import {
  applyLintFixes,
  type LintFinding,
  type LintReport,
  lintVault,
  renderLintReportMd,
  writeLintReport,
} from "../src/core/lint.ts";
import { type SourcePacketManifest, writeManifest } from "../src/core/manifest.ts";
import { vaultLayout } from "../src/core/paths.ts";

let tmpRoot: string;
let vaultRoot: string;

const fixedNow = () => new Date(Date.UTC(2024, 0, 5, 9, 0, 0));
const sha = (text: string): string => contentHash(Buffer.from(text, "utf8"));

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-lint-"));
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

function writeFileSource(
  packetId: string,
  originPath: string,
  originHash: string,
  ingestStatus: SourcePacketManifest["ingest"]["status"] = "pending",
): void {
  const dir = path.join(vaultLayout(vaultRoot).sourcesRoot, packetId);
  fs.mkdirSync(dir, { recursive: true });
  writeManifest(dir, {
    schemaVersion: 1,
    id: packetId,
    packetDir: dir,
    createdAt: "2024-01-05T09:00:00.000Z",
    origin: { sourceType: "file", originPath, originHash },
    contentHash: originHash,
    ingest: { status: ingestStatus },
  });
}

function writeInboxFile(name: string, content: string): string {
  const abs = path.join(vaultLayout(vaultRoot).inbox, name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return abs;
}

function findingsOf(report: LintReport, kind: LintFinding["kind"]): LintFinding[] {
  return report.findings.filter((f) => f.kind === kind);
}

describe("lintVault — per-issue fixtures", () => {
  it("flags orphan pages (no incoming links), exempting overview and the <=1-page case", () => {
    writePage("overview.md", "# Overview\n");
    writePage("concepts/lonely.md", "---\ntitle: Lonely\ntype: concept\n---\n# Lonely\n");
    writePage("concepts/hub.md", "---\ntitle: Hub\ntype: concept\n---\nLinks to [[Lonely]].\n");

    const report = lintVault(vaultRoot, { now: fixedNow });

    const orphans = findingsOf(report, "orphan_page").map((f) => f.page);
    expect(orphans).toEqual(["concepts/hub"]);
    expect(orphans).not.toContain("overview");
  });

  it("does not flag orphans when the wiki has only one page", () => {
    writePage("concepts/solo.md", "---\ntitle: Solo\ntype: concept\n---\n# Solo\n");
    expect(findingsOf(lintVault(vaultRoot, { now: fixedNow }), "orphan_page")).toEqual([]);
  });

  it("flags broken wikilinks", () => {
    writePage("concepts/foo.md", "---\ntitle: Foo\ntype: concept\n---\n[[ghost]] and [[concepts/missing]]\n");

    const report = lintVault(vaultRoot, { now: fixedNow });
    const broken = findingsOf(report, "broken_wikilink");
    expect(broken.map((f) => f.detail?.target)).toEqual(["concepts/missing", "ghost"]);
    expect(broken.every((f) => f.page === "concepts/foo")).toBe(true);
  });

  it("flags duplicate aliases claimed by multiple pages", () => {
    writePage("concepts/a.md", "---\ntitle: Alpha\ntype: concept\naliases: [Shared]\n---\n");
    writePage("entities/b.md", "---\ntitle: Beta\ntype: entity\naliases: [shared]\n---\n");

    const dup = findingsOf(lintVault(vaultRoot, { now: fixedNow }), "duplicate_alias");
    expect(dup).toHaveLength(1);
    expect(dup[0]?.aliases?.sort()).toEqual(["concepts/a", "entities/b"]);
  });

  it("flags dangling source references (page cites an unknown Source Packet)", () => {
    writePage("sources/s.md", "---\ntitle: S\ntype: source\nsources: [SRC-2024-01-05-999]\n---\n");

    const report = lintVault(vaultRoot, { now: fixedNow });
    const dangling = findingsOf(report, "dangling_source_ref");
    expect(dangling).toHaveLength(1);
    expect(dangling[0]?.severity).toBe("error");
    expect(dangling[0]?.source).toBe("SRC-2024-01-05-999");
  });

  it("flags ingested Source Packets cited by no page (uncovered)", () => {
    writeFileSource("SRC-2024-01-05-001", "/tmp/a.md", sha("a"), "ingested");

    const report = lintVault(vaultRoot, { now: fixedNow });
    const uncovered = findingsOf(report, "uncovered_source");
    expect(uncovered.map((f) => f.source)).toEqual(["SRC-2024-01-05-001"]);
  });

  it("does not flag pending sources as uncovered (they are an ingest backlog, shown in status)", () => {
    writeFileSource("SRC-2024-01-05-001", "/tmp/a.md", sha("a"), "pending");
    expect(findingsOf(lintVault(vaultRoot, { now: fixedNow }), "uncovered_source")).toEqual([]);
  });

  it("flags uncaptured and modified inbox files", () => {
    const changed = writeInboxFile("changed.md", "new content");
    writeFileSource("SRC-2024-01-05-001", changed, sha("old content"));
    writeInboxFile("fresh.md", "fresh");

    const report = lintVault(vaultRoot, { now: fixedNow });
    expect(findingsOf(report, "inbox_uncaptured").map((f) => f.path)).toEqual(["inbox/fresh.md"]);
    expect(findingsOf(report, "inbox_modified").map((f) => f.path)).toEqual(["inbox/changed.md"]);
  });

  it("reports a clean vault with zero findings", () => {
    writePage("overview.md", "# Overview\n");
    const report = lintVault(vaultRoot, { now: fixedNow });
    expect(report.summary.total).toBe(0);
    expect(report.summary.errors).toBe(0);
    expect(report.summary.warnings).toBe(0);
  });
});

describe("lintVault — report shape", () => {
  it("fills summary.byKind and sorts findings deterministically", () => {
    writePage("concepts/foo.md", "---\ntitle: Foo\ntype: concept\n---\n[[ghost]]\n");
    writePage("entities/bar.md", "---\ntitle: Foo\ntype: entity\n---\n");
    writeInboxFile("new.md", "x");

    const report = lintVault(vaultRoot, { now: fixedNow });

    expect(report.vault).toBe(vaultRoot);
    expect(report.generatedAt).toBe("2024-01-05T09:00:00.000Z");
    expect(report.summary.byKind.duplicate_alias).toBe(1);
    expect(report.summary.byKind.broken_wikilink).toBe(1);
    expect(report.summary.byKind.inbox_uncaptured).toBe(1);
    const order = [
      "dangling_source_ref",
      "broken_wikilink",
      "duplicate_alias",
      "orphan_page",
      "uncovered_source",
      "inbox_uncaptured",
      "inbox_modified",
    ];
    const rank = (k: string): number => order.indexOf(k);
    const ranks = report.findings.map((f) => rank(f.kind));
    expect(ranks).toEqual([...ranks].sort());
  });
});

describe("renderLintReportMd", () => {
  it("renders a header, grouped findings, and a clean message when empty", () => {
    const clean = lintVault(vaultRoot, { now: fixedNow });
    expect(renderLintReportMd(clean)).toContain("_No issues found._");

    writePage("concepts/foo.md", "---\ntitle: Foo\ntype: concept\n---\n[[ghost]]\n");
    writeInboxFile("new.md", "x");
    const report = lintVault(vaultRoot, { now: fixedNow });
    const md = renderLintReportMd(report);
    expect(md).toContain("# Wiki Lint Report");
    expect(md).toContain("Broken wikilinks (1)");
    expect(md).toContain("Inbox — uncaptured files (1)");
    expect(md).toContain('[[concepts/foo]] links to unresolved target "ghost"');
  });
});

describe("writeLintReport", () => {
  it("writes meta/lint-report.md atomically and returns its path", () => {
    writePage("concepts/foo.md", "---\ntitle: Foo\ntype: concept\n---\n[[ghost]]\n");
    const report = lintVault(vaultRoot, { now: fixedNow });
    const written = writeLintReport(vaultRoot, report);
    expect(written).toBe(vaultLayout(vaultRoot).lintReport);
    expect(fs.existsSync(written)).toBe(true);
    expect(fs.readFileSync(written, "utf8")).toContain("Broken wikilinks (1)");
  });
});

describe("applyLintFixes", () => {
  it("auto-captures uncaptured inbox files and recomputes remaining", async () => {
    writeInboxFile("fresh.md", "# Fresh\n");
    const report = lintVault(vaultRoot, { now: fixedNow });
    expect(report.summary.byKind.inbox_uncaptured).toBe(1);

    const result = await applyLintFixes(vaultRoot, report, { now: fixedNow });

    expect(result.captured).toHaveLength(1);
    expect(result.captured[0]?.relPath).toBe("inbox/fresh.md");
    expect(result.captured[0]?.packetId).toBe("SRC-2024-01-05-001");
    expect(result.remaining).toBe(0);
    expect(result.report.summary.total).toBe(0);
    expect(fs.existsSync(path.join(vaultLayout(vaultRoot).sourcesRoot, "SRC-2024-01-05-001", "manifest.json"))).toBe(
      true,
    );
  });

  it("leaves modified inbox files untouched (no safe auto-fix; capture dedups by path)", async () => {
    const changed = writeInboxFile("changed.md", "new content");
    writeFileSource("SRC-2024-01-05-001", changed, sha("old content"));
    const report = lintVault(vaultRoot, { now: fixedNow });

    const result = await applyLintFixes(vaultRoot, report, { now: fixedNow });

    expect(result.captured).toEqual([]);
    expect(result.remaining).toBe(1);
  });
});
