import { describe, expect, it } from "vitest";
import { resolveChildToolNames } from "../../src/agents/child-tools.ts";

describe("resolveChildToolNames", () => {
  describe("no persona tools", () => {
    it("returns the read-only set when isolated", () => {
      expect(resolveChildToolNames(true, undefined)).toEqual(["read", "grep", "glob", "ls", "web_search", "web_fetch"]);
    });

    it("returns the full set when not isolated", () => {
      expect(resolveChildToolNames(false, undefined)).toEqual([
        "read",
        "bash",
        "edit",
        "write",
        "grep",
        "glob",
        "ls",
        "web_search",
        "web_fetch",
      ]);
    });

    it("falls back to base when persona list is empty", () => {
      expect(resolveChildToolNames(true, [])).toEqual(resolveChildToolNames(true, undefined));
    });
  });

  describe("persona narrows built-in tools", () => {
    it("keeps only declared built-in tools (isolated)", () => {
      expect(resolveChildToolNames(true, ["read", "grep"])).toEqual(["read", "grep"]);
    });

    it("deduplicates and lower-cases", () => {
      expect(resolveChildToolNames(true, ["READ", "read", "Grep"])).toEqual(["read", "grep"]);
    });

    it("keeps unknown non-isolated-forbidden names as extra tools", () => {
      expect(resolveChildToolNames(true, ["read", "nonexistent"])).toEqual(["read", "nonexistent"]);
    });
  });

  describe("persona adds extra (non-built-in) tools", () => {
    it("adds an extra tool alongside built-in tools (isolated)", () => {
      expect(resolveChildToolNames(true, ["read", "grep", "git_clone"])).toEqual(["read", "grep", "git_clone"]);
    });

    it("adds an extra tool when not isolated too", () => {
      expect(resolveChildToolNames(false, ["read", "git_clone"])).toEqual(["read", "git_clone"]);
    });

    it("adds multiple extra tools, preserving order", () => {
      expect(resolveChildToolNames(true, ["git_clone", "read", "another_custom"])).toEqual([
        "git_clone",
        "read",
        "another_custom",
      ]);
    });
  });

  describe("isolated safety boundary", () => {
    it("forbids bash when isolated, even if persona requests it", () => {
      expect(resolveChildToolNames(true, ["read", "bash"])).toEqual(["read"]);
    });

    it("forbids edit when isolated, even if persona requests it", () => {
      expect(resolveChildToolNames(true, ["read", "edit"])).toEqual(["read"]);
    });

    it("forbids write when isolated, even if persona requests it", () => {
      expect(resolveChildToolNames(true, ["read", "write"])).toEqual(["read"]);
    });

    it("allows bash/edit/write when not isolated", () => {
      expect(resolveChildToolNames(false, ["read", "bash", "edit", "write"])).toEqual([
        "read",
        "bash",
        "edit",
        "write",
      ]);
    });
  });

  describe("delegation tools are never returned", () => {
    it("drops subagent even when explicitly listed", () => {
      const result = resolveChildToolNames(false, ["read", "subagent", "subagent_status"]);
      expect(result).toEqual(["read"]);
      expect(result).not.toContain("subagent");
      expect(result).not.toContain("subagent_status");
    });
  });
});
