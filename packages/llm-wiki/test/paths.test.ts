import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { VAULT_DIR_NAME, vaultLayout } from "../src/core/paths.ts";

describe("vaultLayout", () => {
  it("places every file/dir relative to the vault root", () => {
    const root = path.join("/tmp", "fake-vault");
    const layout = vaultLayout(root);

    expect(path.relative(root, layout.root)).toBe("");
    expect(path.relative(root, layout.config)).toBe("config.json");
    expect(path.relative(root, layout.schema)).toBe("WIKI_SCHEMA.md");
    expect(path.relative(root, layout.purpose)).toBe("purpose.md");
    expect(path.relative(root, layout.templates)).toBe("templates");
    expect(path.relative(root, layout.inbox)).toBe("inbox");

    expect(path.relative(root, layout.sourcesRoot)).toBe("raw/sources");

    expect(path.relative(root, layout.wiki)).toBe("wiki");
    expect(path.relative(root, layout.wikiOverview)).toBe("wiki/overview.md");
    expect(path.relative(root, layout.wikiSources)).toBe("wiki/sources");
    expect(path.relative(root, layout.wikiConcepts)).toBe("wiki/concepts");
    expect(path.relative(root, layout.wikiEntities)).toBe("wiki/entities");
    expect(path.relative(root, layout.wikiSyntheses)).toBe("wiki/syntheses");
    expect(path.relative(root, layout.wikiAnalyses)).toBe("wiki/analyses");

    expect(path.relative(root, layout.meta)).toBe("meta");
    expect(path.relative(root, layout.registry)).toBe("meta/registry.json");
    expect(path.relative(root, layout.backlinks)).toBe("meta/backlinks.json");
    expect(path.relative(root, layout.metaIndex)).toBe("meta/index.md");
    expect(path.relative(root, layout.events)).toBe("meta/events.jsonl");
    expect(path.relative(root, layout.log)).toBe("meta/log.md");
    expect(path.relative(root, layout.lintReport)).toBe("meta/lint-report.md");
    expect(path.relative(root, layout.review)).toBe("meta/review.jsonl");
  });

  it("exposes the vault directory name", () => {
    expect(VAULT_DIR_NAME).toBe(".llm-wiki");
  });
});
