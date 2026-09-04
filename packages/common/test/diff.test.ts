import { describe, expect, it } from "vitest";
import { generateUnifiedDiff } from "../src/diff.ts";

describe("generateUnifiedDiff", () => {
  it("returns an empty string for identical texts", () => {
    expect(generateUnifiedDiff("a.ts", "same\n", "same\n")).toBe("");
  });

  it("emits a git-style header and one hunk with context", () => {
    const old = "one\ntwo\nthree\nfour\nfive\nsix\nseven\n";
    const next = "one\ntwo\nthree\nfour\nfive\nsix\nSEVEN\n";
    const diff = generateUnifiedDiff("src/a.ts", old, next);

    expect(diff).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(diff).toContain("--- a/src/a.ts");
    expect(diff).toContain("+++ b/src/a.ts");
    expect(diff).toMatch(/@@ -4,4 \+4,4 @@/);
    expect(diff).toContain("-seven");
    expect(diff).toContain("+SEVEN");
    expect(diff).toContain(" four");
  });

  it("splits distant changes into separate hunks", () => {
    const old = `${Array.from({ length: 20 }, (_, i) => `line-${i + 1}`).join("\n")}\n`;
    const next = old.replace("line-2\n", "changed-2\n").replace("line-18\n", "changed-18\n");
    const diff = generateUnifiedDiff("a.ts", old, next);

    const hunkCount = (diff.match(/^@@/gm) ?? []).length;
    expect(hunkCount).toBe(2);
  });
});
