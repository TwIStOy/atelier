import { describe, expect, it } from "vitest";
import { extractWikilinkTargets } from "../src/core/wikilinks.ts";

describe("extractWikilinkTargets", () => {
  it("extracts a plain [[target]]", () => {
    expect(extractWikilinkTargets("see [[foo]] for details")).toEqual(["foo"]);
  });

  it("strips a display label after the pipe", () => {
    expect(extractWikilinkTargets("[[foo|the foo page]]")).toEqual(["foo"]);
  });

  it("strips a heading reference after #", () => {
    expect(extractWikilinkTargets("[[concepts/bar#Section]]")).toEqual(["concepts/bar"]);
  });

  it("strips a block reference after #^", () => {
    expect(extractWikilinkTargets("[[entities/baz#^block1]]")).toEqual(["entities/baz"]);
  });

  it("keeps path-like targets intact", () => {
    expect(extractWikilinkTargets("[[sources/SRC-2024-01-05-001]]")).toEqual(["sources/SRC-2024-01-05-001"]);
  });

  it("returns targets in order of appearance and keeps duplicates", () => {
    const body = "[[a]] then [[b]] then [[a]] again";
    expect(extractWikilinkTargets(body)).toEqual(["a", "b", "a"]);
  });

  it("trims whitespace around the target", () => {
    expect(extractWikilinkTargets("[[  concepts/spaces  ]]")).toEqual(["concepts/spaces"]);
  });

  it("ignores wikilinks inside fenced code blocks", () => {
    const body = "[[real]]\n\n```\n[[fake-inside-code]]\n[[also-fake]]\n```\n\n[[real2]]";
    expect(extractWikilinkTargets(body)).toEqual(["real", "real2"]);
  });

  it("returns an empty array when there are no links", () => {
    expect(extractWikilinkTargets("plain text, no links here")).toEqual([]);
  });

  it("does not match malformed single-bracket tokens", () => {
    expect(extractWikilinkTargets("[not a link] and [[also not")).toEqual([]);
  });
});
