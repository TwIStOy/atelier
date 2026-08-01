import { describe, expect, it } from "vitest";
import { type AnalysisResult, type GenerationResult, parseAnalysis, parseGeneration } from "../src/core/ingest.ts";

describe("parseAnalysis", () => {
  it("extracts a full structured analysis from a wiki-analysis fence", () => {
    const text = [
      "Here is my analysis.",
      "",
      "```wiki-analysis",
      JSON.stringify({
        summary: "The source argues X over Y.",
        entities: [{ title: "OpenAI", kind: "org", note: "released GPT" }],
        concepts: [{ title: "Transformer", note: "core architecture" }],
        syntheses: [{ title: "Scale wins", note: "from multiple papers" }],
        contradictions: [{ against: "concepts/rnn", note: "opposite claim" }],
        links: ["concepts/transformer", "entities/openai"],
        review: [{ kind: "coverage_gap", title: "Missing benchmark", action: "create_page", query: "MMLU results" }],
      }),
      "```",
      "",
      "That's all.",
    ].join("\n");

    const result = parseAnalysis(text);
    expect(result).not.toBeNull();
    const a = result as AnalysisResult;
    expect(a.summary).toBe("The source argues X over Y.");
    expect(a.entities).toEqual([{ title: "OpenAI", kind: "org", note: "released GPT" }]);
    expect(a.concepts).toEqual([{ title: "Transformer", note: "core architecture" }]);
    expect(a.syntheses).toHaveLength(1);
    expect(a.syntheses[0].title).toBe("Scale wins");
    expect(a.contradictions[0].against).toBe("concepts/rnn");
    expect(a.links).toEqual(["concepts/transformer", "entities/openai"]);
    expect(a.review).toHaveLength(1);
    expect(a.review[0]).toMatchObject({ kind: "coverage_gap", action: "create_page", query: "MMLU results" });
  });

  it("returns null when no wiki-analysis fence is present", () => {
    expect(parseAnalysis("just prose, no fence")).toBeNull();
  });

  it("returns null when the fence holds invalid JSON", () => {
    const text = "```wiki-analysis\n{not valid json\n```";
    expect(parseAnalysis(text)).toBeNull();
  });

  it("coerces an invalid review action to skip and keeps the item", () => {
    const text = [
      "```wiki-analysis",
      JSON.stringify({
        summary: "s",
        review: [{ kind: "k", title: "t", action: "nuke_everything" }],
      }),
      "```",
    ].join("\n");

    const a = parseAnalysis(text) as AnalysisResult;
    expect(a.review[0].action).toBe("skip");
    expect(a.review[0].title).toBe("t");
  });

  it("defaults missing arrays to empty and summary to empty string", () => {
    const text = "```wiki-analysis\n{}\n```";
    const a = parseAnalysis(text) as AnalysisResult;
    expect(a.summary).toBe("");
    expect(a.entities).toEqual([]);
    expect(a.concepts).toEqual([]);
    expect(a.review).toEqual([]);
  });
});

describe("parseGeneration", () => {
  it("extracts source and concept page specs with frontmatter and body", () => {
    const text = [
      "Some prose.",
      "",
      "```wiki-page:source",
      "---",
      "type: source",
      "title: Attention Is All You Need",
      "sources: [SRC-2024-01-05-001]",
      "---",
      "# Attention Is All You Need",
      "",
      "Introduces the Transformer. See [[sources/SRC-2024-01-05-001]].",
      "```",
      "",
      "```wiki-page:concept",
      "---",
      "type: concept",
      "title: Self-Attention",
      "---",
      "# Self-Attention",
      "",
      "Core mechanism.",
      "```",
    ].join("\n");

    const result = parseGeneration(text);
    expect(result).not.toBeNull();
    const g = result as GenerationResult;
    expect(g.pages).toHaveLength(2);
    expect(g.pages[0]).toMatchObject({
      type: "source",
      title: "Attention Is All You Need",
      sources: ["SRC-2024-01-05-001"],
    });
    expect(g.pages[0].body).toContain("# Attention Is All You Need");
    expect(g.pages[0].body).toContain("[[sources/SRC-2024-01-05-001]]");
    expect(g.pages[1].type).toBe("concept");
    expect(g.pages[1].title).toBe("Self-Attention");
    expect(g.pages[1].sources).toEqual([]);
  });

  it("captures an optional wiki-overview fence", () => {
    const text = [
      "```wiki-page:source",
      "---",
      "type: source",
      "title: T",
      "---",
      "# T",
      "```",
      "```wiki-overview",
      "# Wiki Overview",
      "",
      "- one source ingested",
      "```",
    ].join("\n");

    const g = parseGeneration(text) as GenerationResult;
    expect(g.overview).toBe("# Wiki Overview\n\n- one source ingested");
  });

  it("returns null when no wiki-page fence is present", () => {
    const text = "```wiki-overview\n# Overview only\n```";
    expect(parseGeneration(text)).toBeNull();
  });

  it("skips a page fence whose declared type is not a known Page Type", () => {
    const text = [
      "```wiki-page:source",
      "---",
      "type: source",
      "title: T",
      "---",
      "# T",
      "```",
      "```wiki-page:mystery",
      "---",
      "type: mystery",
      "title: X",
      "---",
      "# X",
      "```",
    ].join("\n");

    const g = parseGeneration(text) as GenerationResult;
    expect(g.pages).toHaveLength(1);
    expect(g.pages[0].type).toBe("source");
  });

  it("returns an empty pages array when a page fence has no title", () => {
    const text = ["```wiki-page:source", "---", "type: source", "---", "# No title field", "```"].join("\n");

    const g = parseGeneration(text) as GenerationResult;
    expect(g.pages).toEqual([]);
  });
});
