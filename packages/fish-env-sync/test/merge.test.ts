import { describe, expect, it } from "vitest";
import { mergeVarsIntoEnv } from "../src/merge.ts";
import type { FishUniversalVar } from "../src/parse.ts";

function v(name: string, values: string[], opts: { exported?: boolean; pathvar?: boolean } = {}): FishUniversalVar {
  return {
    name,
    values,
    exported: opts.exported ?? true,
    pathvar: opts.pathvar ?? false,
  };
}

describe("mergeVarsIntoEnv - export filter", () => {
  it("ignores non-exported vars entirely", () => {
    const target: Record<string, string> = {};
    mergeVarsIntoEnv([v("SECRET", ["hush"], { exported: false })], target);
    expect(target).toEqual({});
  });

  it("merges exported vars", () => {
    const target: Record<string, string> = {};
    mergeVarsIntoEnv([v("FOO", ["bar"])], target);
    expect(target.FOO).toBe("bar");
  });
});

describe("mergeVarsIntoEnv - list joining", () => {
  it("joins a pathvar list with ':' (colon)", () => {
    const target: Record<string, string> = {};
    mergeVarsIntoEnv([v("PATH", ["/a", "/b", "/c"], { pathvar: true })], target);
    expect(target.PATH).toBe("/a:/b:/c");
  });

  it("joins a non-pathvar list with ' ' (single space)", () => {
    const target: Record<string, string> = {};
    mergeVarsIntoEnv([v("MY_LIST", ["a", "b", "c"])], target);
    expect(target.MY_LIST).toBe("a b c");
  });

  it("keeps a single-element value as-is regardless of pathvar flag", () => {
    const t1: Record<string, string> = {};
    mergeVarsIntoEnv([v("SINGLE", ["value"], { pathvar: false })], t1);
    expect(t1.SINGLE).toBe("value");
    const t2: Record<string, string> = {};
    mergeVarsIntoEnv([v("SINGLE_P", ["value"], { pathvar: true })], t2);
    expect(t2.SINGLE_P).toBe("value");
  });

  it("handles FISH_USER_PATHS (exported, non-path) as space-joined", () => {
    const target: Record<string, string> = {};
    mergeVarsIntoEnv([v("FISH_USER_PATHS", ["/opt/a", "/opt/b"])], target);
    expect(target.FISH_USER_PATHS).toBe("/opt/a /opt/b");
  });
});

describe("mergeVarsIntoEnv - PATH dedup", () => {
  it("does not duplicate entries already in PATH", () => {
    const target: Record<string, string> = { PATH: "/usr/bin:/bin" };
    mergeVarsIntoEnv([v("PATH", ["/usr/bin", "/usr/local/bin"], { pathvar: true })], target);
    expect(target.PATH).toBe("/usr/bin:/usr/local/bin:/bin");
  });

  it("prepends new pathvar entries (new value wins ordering) while dedup", () => {
    const target: Record<string, string> = { PATH: "/x:/y" };
    mergeVarsIntoEnv([v("PATH", ["/a", "/y", "/b"], { pathvar: true })], target);
    expect(target.PATH).toBe("/a:/y:/b:/x");
  });

  it("handles PATH when the target has no existing PATH", () => {
    const target: Record<string, string> = {};
    mergeVarsIntoEnv([v("PATH", ["/a", "/b"], { pathvar: true })], target);
    expect(target.PATH).toBe("/a:/b");
  });

  it("does not lose existing PATH entries not present in the new value", () => {
    const target: Record<string, string> = { PATH: "/keep1:/keep2" };
    mergeVarsIntoEnv([v("PATH", ["/keep1"], { pathvar: true })], target);
    expect(target.PATH).toBe("/keep1:/keep2");
  });
});

describe("mergeVarsIntoEnv - overwrite vs PATH", () => {
  it("overwrites non-PATH exported vars with the new value", () => {
    const target: Record<string, string> = { FOO: "old" };
    mergeVarsIntoEnv([v("FOO", ["new"])], target);
    expect(target.FOO).toBe("new");
  });

  it("does not mutate unrelated keys", () => {
    const target: Record<string, string> = { UNTOUCHED: "x" };
    mergeVarsIntoEnv([v("FOO", ["bar"])], target);
    expect(target.UNTOUCHED).toBe("x");
  });
});
