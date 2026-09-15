import { expect, it } from "vitest";
import { formatDirectoryContext } from "../src/format.ts";

it("wraps content in a directory context block", () => {
  const out = formatDirectoryContext({
    directory: "/x",
    absolutePath: "/x/AGENTS.md",
    content: "rules",
    truncated: false,
  });
  expect(out).toBe("\n\n[Directory Context for /x: /x/AGENTS.md]\nrules");
});

it("appends a truncation notice when truncated", () => {
  const out = formatDirectoryContext({
    directory: "/x",
    absolutePath: "/x/AGENTS.md",
    content: "rules",
    truncated: true,
  });
  expect(out).toContain("[Note: Content was truncated");
  expect(out).toContain("/x/AGENTS.md");
});
