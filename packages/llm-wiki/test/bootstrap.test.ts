import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type BootstrapResult, bootstrapVault, PAGE_TYPES } from "../src/core/bootstrap.ts";
import { vaultLayout } from "../src/core/paths.ts";

let tmpRoot: string;
let vaultRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-bootstrap-"));
  vaultRoot = path.join(tmpRoot, "vault");
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const fixedNow = () => new Date(Date.UTC(2024, 0, 5, 8, 0, 0));

function readFile(rel: string): string {
  return fs.readFileSync(path.join(vaultRoot, rel), "utf8");
}

function exists(rel: string): boolean {
  const target = path.join(vaultRoot, rel);
  return fs.existsSync(target);
}

describe("bootstrapVault — fresh vault", () => {
  it("reports created=true and creates every directory of the PLAN vault layout", () => {
    const result = bootstrapVault(vaultRoot, { now: fixedNow });

    expect(result.created).toBe(true);
    expect(result.root).toBe(vaultRoot);

    const layout = vaultLayout(vaultRoot);
    for (const dir of [
      layout.inbox,
      layout.sourcesRoot,
      layout.wiki,
      layout.wikiSources,
      layout.wikiConcepts,
      layout.wikiEntities,
      layout.wikiSyntheses,
      layout.wikiAnalyses,
      layout.meta,
      layout.templates,
    ]) {
      expect(fs.statSync(dir).isDirectory()).toBe(true);
    }
  });

  it("creates config.json with a stable schemaVersion, the bootstrapped createdAt, and the page types", () => {
    bootstrapVault(vaultRoot, { now: fixedNow });

    const config = JSON.parse(readFile("config.json"));
    expect(config.schemaVersion).toBe(1);
    expect(config.createdAt).toBe("2024-01-05T08:00:00.000Z");
    expect(config.pageTypes).toEqual([...PAGE_TYPES]);
  });

  it("creates WIKI_SCHEMA.md documenting every Page Type and the vault layout", () => {
    bootstrapVault(vaultRoot, { now: fixedNow });

    const schema = readFile("WIKI_SCHEMA.md");
    for (const type of PAGE_TYPES) {
      expect(schema).toContain(type);
    }
    expect(schema.toLowerCase()).toContain("inbox");
    expect(schema.toLowerCase()).toContain("raw/sources");
  });

  it("creates one template per Page Type under templates/", () => {
    bootstrapVault(vaultRoot, { now: fixedNow });

    for (const type of PAGE_TYPES) {
      const body = readFile(`templates/${type}.md`);
      expect(body).toContain(`type: ${type}`);
    }
  });

  it("creates wiki/overview.md and the meta seed files", () => {
    bootstrapVault(vaultRoot, { now: fixedNow });

    expect(exists("wiki/overview.md")).toBe(true);
    expect(JSON.parse(readFile("meta/registry.json"))).toEqual([]);
    expect(JSON.parse(readFile("meta/backlinks.json"))).toEqual({});
    expect(exists("meta/index.md")).toBe(true);
    expect(exists("meta/events.jsonl")).toBe(true);
    expect(exists("meta/log.md")).toBe(true);
    expect(exists("meta/lint-report.md")).toBe(true);
    expect(exists("meta/review.jsonl")).toBe(true);
  });
});

describe("bootstrapVault — purpose.md topic", () => {
  it("leaves the Topic unset (placeholder) when no topic is given", () => {
    bootstrapVault(vaultRoot, { now: fixedNow });

    const purpose = readFile("purpose.md");
    expect(purpose).toMatch(/<!-- llm-wiki:topic -->/);
    expect(purpose).toMatch(/<!-- \/llm-wiki:topic -->/);
    expect(purpose).not.toContain("Karpathy");
  });

  it("backfills the topic into the Topic marker when a topic is given", () => {
    bootstrapVault(vaultRoot, { topic: "Karpathy-style LLM Wiki for this project", now: fixedNow });

    const purpose = readFile("purpose.md");
    expect(purpose).toMatch(
      /<!-- llm-wiki:topic -->[\s\S]*Karpathy-style LLM Wiki for this project[\s\S]*<!-- \/llm-wiki:topic -->/,
    );
  });
});

describe("bootstrapVault — idempotency", () => {
  it("reports created=false and writes no files on a second run", () => {
    const first = bootstrapVault(vaultRoot, { now: fixedNow });
    expect(first.created).toBe(true);
    expect(first.createdFiles.length).toBeGreaterThan(0);

    const second = bootstrapVault(vaultRoot, { now: () => new Date(Date.UTC(2029, 0, 1, 0, 0, 0)) });
    expect(second.created).toBe(false);
    expect(second.createdFiles).toEqual([]);
  });

  it("does not rewrite config.json (createdAt is frozen from the first bootstrap)", () => {
    bootstrapVault(vaultRoot, { now: fixedNow });
    const before = readFile("config.json");

    bootstrapVault(vaultRoot, { now: () => new Date(Date.UTC(2029, 0, 1, 0, 0, 0)) });
    const after = readFile("config.json");

    expect(after).toBe(before);
    expect(JSON.parse(after).createdAt).toBe("2024-01-05T08:00:00.000Z");
  });

  it("does not rewrite WIKI_SCHEMA.md or templates on a second run", () => {
    bootstrapVault(vaultRoot, { now: fixedNow });
    const schemaBefore = readFile("WIKI_SCHEMA.md");
    const templateBefore = readFile("templates/concept.md");

    bootstrapVault(vaultRoot, { now: fixedNow });
    expect(readFile("WIKI_SCHEMA.md")).toBe(schemaBefore);
    expect(readFile("templates/concept.md")).toBe(templateBefore);
  });

  it("re-running with the same topic leaves purpose.md unchanged", () => {
    bootstrapVault(vaultRoot, { topic: "same topic", now: fixedNow });
    const before = readFile("purpose.md");

    bootstrapVault(vaultRoot, { topic: "same topic", now: fixedNow });
    expect(readFile("purpose.md")).toBe(before);
  });

  it("re-running with a new topic updates only the Topic marker", () => {
    bootstrapVault(vaultRoot, { topic: "old topic", now: fixedNow });
    const before = readFile("purpose.md");

    bootstrapVault(vaultRoot, { topic: "new topic", now: fixedNow });
    const after = readFile("purpose.md");

    expect(after).not.toBe(before);
    expect(after).toMatch(/<!-- llm-wiki:topic -->[\s\S]*new topic[\s\S]*<!-- \/llm-wiki:topic -->/);
    expect(after).not.toMatch(/old topic/);
    expect(after).toMatch(/# Purpose/);
  });

  it("preserves a user-authored purpose.md that has no topic markers", () => {
    fs.mkdirSync(vaultRoot, { recursive: true });
    const custom = "---\ntype: purpose\n---\n\n# My own purpose\n\nHand-written, no markers.\n";
    fs.writeFileSync(path.join(vaultRoot, "purpose.md"), custom, "utf8");

    bootstrapVault(vaultRoot, { topic: "ignored topic", now: fixedNow });

    expect(readFile("purpose.md")).toBe(custom);
  });
});

describe("bootstrapVault — return shape", () => {
  it("lists the relative paths it created on a fresh bootstrap", () => {
    const result: BootstrapResult = bootstrapVault(vaultRoot, { topic: "T", now: fixedNow });

    expect(result.topic).toBe("T");
    expect(result.createdFiles).toContain("config.json");
    expect(result.createdFiles).toContain("WIKI_SCHEMA.md");
    expect(result.createdFiles).toContain("purpose.md");
    expect(result.createdFiles).toContain("templates/source.md");
    expect(result.createdFiles).toContain("templates/analysis.md");
  });
});
