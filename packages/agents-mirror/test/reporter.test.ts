import { join } from "node:path";
import { expect, it } from "vitest";
import { relativeToBase } from "../src/reporter.ts";

it("returns the path relative to the base when inside it", () => {
  expect(relativeToBase("/proj", join("/proj", "src", "AGENTS.md"))).toBe(join("src", "AGENTS.md"));
});

it("returns the absolute path when outside the base", () => {
  expect(relativeToBase("/proj", "/mirror/src/AGENTS.md")).toBe("/mirror/src/AGENTS.md");
});

it("passes through non-absolute paths unchanged", () => {
  expect(relativeToBase("/proj", "AGENTS.md")).toBe("AGENTS.md");
});

it("handles a parent-traversal relative result by falling back to absolute", () => {
  expect(relativeToBase("/proj", "/proj-other/AGENTS.md")).toBe("/proj-other/AGENTS.md");
});
