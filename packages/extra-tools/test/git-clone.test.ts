import { describe, expect, it } from "vitest";
import { deriveCacheName, isForbiddenUrl } from "../src/git-clone/index.ts";

describe("isForbiddenUrl", () => {
  it("rejects file:// URLs", () => {
    expect(isForbiddenUrl("file:///etc/passwd")).toBe(true);
    expect(isForbiddenUrl("FILE://relative/path")).toBe(true);
  });

  it("rejects ssh:// and git+ssh:// URLs", () => {
    expect(isForbiddenUrl("ssh://git@github.com/owner/repo.git")).toBe(true);
    expect(isForbiddenUrl("git+ssh://git@github.com/owner/repo.git")).toBe(true);
  });

  it("accepts https:// URLs", () => {
    expect(isForbiddenUrl("https://github.com/owner/repo.git")).toBe(false);
  });

  it("accepts git:// protocol", () => {
    expect(isForbiddenUrl("git://github.com/owner/repo.git")).toBe(false);
  });

  it("trims before checking", () => {
    expect(isForbiddenUrl("   file://x")).toBe(true);
  });
});

describe("deriveCacheName", () => {
  it("derives owner-repo from an https URL with .git suffix", () => {
    expect(deriveCacheName("https://github.com/octocat/Hello-World.git")).toBe("octocat-Hello-World");
  });

  it("derives owner-repo from a git URL without .git", () => {
    expect(deriveCacheName("git://github.com/sst/opencode")).toBe("sst-opencode");
  });

  it("sanitizes unusual characters in owner/repo", () => {
    expect(deriveCacheName("https://example.com/a.b/c_d/e/f")).toBe("e-f");
  });

  it("respects an explicit repo_name override", () => {
    expect(deriveCacheName("https://github.com/a/b", "my-cache")).toBe("my-cache");
  });

  it("sanitizes the override too", () => {
    expect(deriveCacheName("https://github.com/a/b", "weird name/here")).toBe("weird-name-here");
  });

  it("returns null when override is empty/whitespace and URL has no owner/repo", () => {
    expect(deriveCacheName("not-a-url", "   ")).toBeNull();
  });

  it("returns null for a URL it cannot parse", () => {
    expect(deriveCacheName("https://example.com")).toBeNull();
  });
});
