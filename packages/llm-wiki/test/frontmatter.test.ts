import { describe, expect, it } from "vitest";
import { parseFrontmatter, splitFrontmatter } from "../src/core/frontmatter.ts";

describe("splitFrontmatter", () => {
  it("returns null frontmatter and the full body when there is no leading fence", () => {
    const md = "# Title\n\nbody text\n";
    expect(splitFrontmatter(md)).toEqual({ frontmatter: null, body: md });
  });

  it("splits a leading --- fence into frontmatter text and the remaining body", () => {
    const md = "---\ntitle: Foo\ntype: concept\n---\n# Foo\n\nbody\n";
    expect(splitFrontmatter(md)).toEqual({
      frontmatter: "title: Foo\ntype: concept",
      body: "# Foo\n\nbody\n",
    });
  });

  it("does not treat a fence that is not at the very start as frontmatter", () => {
    const md = "intro\n---\ntitle: Foo\n---\n";
    expect(splitFrontmatter(md)).toEqual({ frontmatter: null, body: md });
  });
});

describe("parseFrontmatter", () => {
  it("parses title, type, inline-array aliases and sources", () => {
    const md =
      "---\ntitle: Foo\ntype: Concept\naliases: [Fooing, Bar]\nsources: [SRC-2024-01-05-001, SRC-2024-01-05-002]\n---\n# Foo\n";
    const { fm, body } = parseFrontmatter(md);
    expect(fm).toEqual({
      title: "Foo",
      type: "Concept",
      aliases: ["Fooing", "Bar"],
      sources: ["SRC-2024-01-05-001", "SRC-2024-01-05-002"],
    });
    expect(body).toBe("# Foo\n");
  });

  it("parses block-list aliases and sources", () => {
    const md = "---\naliases:\n  - A\n  - B\nsources:\n  - SRC-1\n---\nbody\n";
    const { fm } = parseFrontmatter(md);
    expect(fm?.aliases).toEqual(["A", "B"]);
    expect(fm?.sources).toEqual(["SRC-1"]);
  });

  it("accepts quoted scalar values", () => {
    const md = '---\ntitle: "Foo: Bar"\ntype: "concept"\n---\n';
    const { fm } = parseFrontmatter(md);
    expect(fm?.title).toBe("Foo: Bar");
    expect(fm?.type).toBe("concept");
  });

  it("wraps a single-string aliases/sources value into a one-element array", () => {
    const md = "---\naliases: Solo\nsources: SRC-1\n---\n";
    const { fm } = parseFrontmatter(md);
    expect(fm?.aliases).toEqual(["Solo"]);
    expect(fm?.sources).toEqual(["SRC-1"]);
  });

  it("omits title/type when absent and defaults aliases/sources to empty arrays", () => {
    const md = "---\nfoo: bar\n---\n";
    const { fm } = parseFrontmatter(md);
    expect(fm).toEqual({ aliases: [], sources: [] });
  });

  it("returns null frontmatter (and the original body) when there is no fence", () => {
    const md = "# No frontmatter\n\nbody\n";
    const { fm, body } = parseFrontmatter(md);
    expect(fm).toBeNull();
    expect(body).toBe(md);
  });

  it("returns null frontmatter when the YAML is invalid, without throwing", () => {
    const md = "---\ntitle: [unterminated\n---\n# body\n";
    const { fm, body } = parseFrontmatter(md);
    expect(fm).toBeNull();
    expect(body).toBe("# body\n");
  });

  it("drops non-string entries from aliases/sources", () => {
    const md = "---\naliases:\n  - Real\n  - 123\n  - null\nsources:\n  - SRC-1\n  - 42\n---\n";
    const { fm } = parseFrontmatter(md);
    expect(fm?.aliases).toEqual(["Real"]);
    expect(fm?.sources).toEqual(["SRC-1"]);
  });
});
