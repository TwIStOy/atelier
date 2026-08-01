import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapVault, PAGE_TYPES, type PageType } from "../src/core/bootstrap.ts";
import { parseFrontmatter } from "../src/core/frontmatter.ts";
import { type EnsurePageInput, type EnsurePageResult, ensurePage } from "../src/core/page.ts";
import { vaultLayout } from "../src/core/paths.ts";

const DIR_NAME: Record<PageType, string> = {
  source: "sources",
  concept: "concepts",
  entity: "entities",
  synthesis: "syntheses",
  analysis: "analyses",
};

let tmpRoot: string;
let vaultRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-page-"));
  vaultRoot = path.join(tmpRoot, "vault");
  bootstrapVault(vaultRoot, { now: () => new Date(Date.UTC(2024, 0, 5, 9, 0, 0)) });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function ensure(input: EnsurePageInput): EnsurePageResult {
  return ensurePage(vaultRoot, input);
}

function readPage(relWikiPath: string): string {
  return fs.readFileSync(path.join(vaultRoot, "wiki", `${relWikiPath}.md`), "utf8");
}

function readFm(relWikiPath: string): ReturnType<typeof parseFrontmatter> {
  return parseFrontmatter(readPage(relWikiPath));
}

describe("ensurePage — creation across the five Page Types", () => {
  it.each(PAGE_TYPES.map((t) => [t] as const))("creates a %s page under wiki/<type>s/ from its template", (type) => {
    const result = ensure({ type, title: "Sample Title" });

    expect(result.created).toBe(true);
    expect(result.type).toBe(type);
    expect(result.matchedOn).toBeNull();
    expect(result.relPath).toBe(`wiki/${DIR_NAME[type]}/sample-title.md`);
    expect(result.id).toBe(`${DIR_NAME[type]}/sample-title`);
    expect(fs.existsSync(path.join(vaultRoot, result.relPath))).toBe(true);

    const fm = readFm(`${DIR_NAME[type]}/sample-title`);
    expect(fm.fm?.type).toBe(type);
    expect(fm.fm?.title).toBe("Sample Title");
  });

  it("substitutes the <title> placeholder in the template body with the real title", () => {
    ensure({ type: "concept", title: "React Hooks" });
    const body = readPage("concepts/react-hooks");
    expect(body).toContain("# React Hooks");
    expect(body).not.toContain("<title>");
  });

  it("writes title/aliases/sources into the frontmatter and round-trips through parseFrontmatter", () => {
    ensure({
      type: "source",
      title: "Attention Is All You Need",
      aliases: ["Transformer paper"],
      sources: ["SRC-2024-01-05-001"],
    });

    const fm = readFm("sources/attention-is-all-you-need");
    expect(fm.fm?.title).toBe("Attention Is All You Need");
    expect(fm.fm?.aliases).toEqual(["Transformer paper"]);
    expect(fm.fm?.sources).toEqual(["SRC-2024-01-05-001"]);
  });

  it("preserves type-specific template frontmatter keys (entity kind, analysis question, related)", () => {
    ensure({ type: "entity", title: "OpenAI" });
    ensure({ type: "analysis", title: "Why Transformers Win" });
    ensure({ type: "concept", title: "Attention" });

    expect(readPage("entities/openai")).toMatch(/^kind:/m);
    expect(readPage("analyses/why-transformers-win")).toMatch(/^question:/m);
    expect(readPage("concepts/attention")).toMatch(/^related:/m);
  });

  it("emits aliases: [] and sources: [] when none are given", () => {
    ensure({ type: "concept", title: "Solo" });
    const fm = readFm("concepts/solo");
    expect(fm.fm?.aliases).toEqual([]);
    expect(fm.fm?.sources).toEqual([]);
  });
});

describe("ensurePage — resolve-or-create idempotency (same type)", () => {
  it("returns the existing page on a second call with the same title (no duplicate file)", () => {
    const first = ensure({ type: "concept", title: "React" });
    const second = ensure({ type: "concept", title: "React" });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(second.matchedOn).toBe("title");
    expect(second.matchedId).toBe(first.id);
    expect(fs.readdirSync(path.join(vaultRoot, "wiki", "concepts"))).toHaveLength(1);
  });

  it("resolves when the new title matches an existing alias", () => {
    const first = ensure({ type: "concept", title: "React", aliases: ["Hooks Lib"] });
    const second = ensure({ type: "concept", title: "Hooks Lib" });

    expect(second.created).toBe(false);
    expect(second.matchedOn).toBe("title");
    expect(second.id).toBe(first.id);
  });

  it("resolves when a new alias matches an existing title", () => {
    const first = ensure({ type: "concept", title: "React" });
    const second = ensure({ type: "concept", title: "Other Name", aliases: ["React"] });

    expect(second.created).toBe(false);
    expect(second.matchedOn).toBe("alias");
    expect(second.id).toBe(first.id);
  });

  it("resolves when a new alias matches an existing alias", () => {
    const first = ensure({ type: "entity", title: "Google", aliases: ["Alphabet"] });
    const second = ensure({ type: "entity", title: "Unrelated", aliases: ["Alphabet"] });

    expect(second.created).toBe(false);
    expect(second.matchedOn).toBe("alias");
    expect(second.id).toBe(first.id);
  });

  it("matches case-insensitively and tolerates surrounding whitespace", () => {
    const first = ensure({ type: "concept", title: "React" });
    const second = ensure({ type: "concept", title: "  REACT  " });

    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
  });
});

describe("ensurePage — cross-type coexistence", () => {
  it("creates separate pages when the same name is filed under different types", () => {
    const source = ensure({ type: "source", title: "Transformer" });
    const entity = ensure({ type: "entity", title: "Transformer" });

    expect(source.created).toBe(true);
    expect(entity.created).toBe(true);
    expect(source.id).toBe("sources/transformer");
    expect(entity.id).toBe("entities/transformer");
    expect(source.id).not.toBe(entity.id);
  });
});

describe("ensurePage — slug derivation", () => {
  it("lowercases and kebab-cases an ASCII title", () => {
    expect(ensure({ type: "concept", title: "React Hooks" }).id).toBe("concepts/react-hooks");
    expect(ensure({ type: "concept", title: "A/B Testing 101" }).id).toBe("concepts/a-b-testing-101");
  });

  it("strips combining accents (NFKD) so accented titles produce an ASCII slug", () => {
    expect(ensure({ type: "concept", title: "Café" }).id).toBe("concepts/cafe");
  });

  it("falls back to a deterministic hash slug when the title has no ASCII (CJK)", () => {
    const result = ensure({ type: "concept", title: "反应钩子" });
    expect(result.id).toMatch(/^concepts\/page-[0-9a-f]{8}$/);
    expect(fs.existsSync(path.join(vaultRoot, result.relPath))).toBe(true);

    const again = ensure({ type: "concept", title: "反应钩子" });
    expect(again.created).toBe(false);
    expect(again.id).toBe(result.id);
  });

  it("honours an explicit slug override (and slugifies it)", () => {
    const result = ensure({ type: "concept", title: "反应钩子", slug: "React Hooks" });
    expect(result.id).toBe("concepts/react-hooks");
  });

  it("ignores a blank slug override and falls back to the title-derived slug", () => {
    const result = ensure({ type: "concept", title: "React Hooks", slug: "   " });
    expect(result.id).toBe("concepts/react-hooks");
  });

  it("disambiguates with a -N suffix when the slug path is taken by an unrelated page", () => {
    fs.writeFileSync(
      path.join(vaultRoot, "wiki", "concepts", "react.md"),
      "---\ntype: concept\ntitle: Different Thing\naliases: []\nsources: []\n---\n# Different Thing\n",
      "utf8",
    );

    const result = ensure({ type: "concept", title: "React" });
    expect(result.created).toBe(true);
    expect(result.id).toBe("concepts/react-2");
    expect(fs.existsSync(path.join(vaultRoot, "wiki", "concepts", "react-2.md"))).toBe(true);
  });
});

describe("ensurePage — input cleaning", () => {
  it("trims and dedupes aliases and sources before writing", () => {
    ensure({
      type: "concept",
      title: "Dupes",
      aliases: ["  Foo  ", "Foo", "Bar"],
      sources: ["SRC-1", "SRC-1", " SRC-2 "],
    });
    const fm = readFm("concepts/dupes");
    expect(fm.fm?.aliases).toEqual(["Foo", "Bar"]);
    expect(fm.fm?.sources).toEqual(["SRC-1", "SRC-2"]);
  });
});

describe("ensurePage — validation", () => {
  it.each(["", "   "] as const)("throws when the title is blank (%j)", (title) => {
    expect(() => ensure({ type: "concept", title })).toThrow(/title/i);
  });

  it("throws when the type is not a known Page Type", () => {
    expect(() => ensure({ type: "nonsense" as PageType, title: "X" })).toThrow(/type/i);
  });
});

describe("ensurePage — return shape", () => {
  it("reports an absolute path and a vault-relative path on creation", () => {
    const result = ensure({ type: "synthesis", title: "Big Picture" });
    expect(path.isAbsolute(result.path)).toBe(true);
    expect(result.relPath).toBe("wiki/syntheses/big-picture.md");
    expect(result.title).toBe("Big Picture");
  });

  it("uses the vault layout's per-type directory for every type", () => {
    const layout = vaultLayout(vaultRoot);
    const cases: ReadonlyArray<readonly [PageType, string]> = [
      ["source", "sources"],
      ["concept", "concepts"],
      ["entity", "entities"],
      ["synthesis", "syntheses"],
      ["analysis", "analyses"],
    ];
    for (const [type, dirName] of cases) {
      const result = ensure({ type, title: `T-${type}` });
      expect(result.path.startsWith(layout.wiki)).toBe(true);
      expect(result.path).toContain(`wiki/${dirName}/`);
    }
  });
});
