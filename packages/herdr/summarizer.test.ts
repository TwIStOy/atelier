import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { firstUserPrompt, parseSessionTitle } from "./summarizer.ts";

function msgEntry(message: AgentMessage, id: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date(Number(id)).toISOString(),
    message,
  } as SessionEntry;
}

function userEntry(text: string, id: string): SessionEntry {
  return msgEntry({ role: "user", content: text, timestamp: Number(id) } as AgentMessage, id);
}

function assistantEntry(text: string, id: string): SessionEntry {
  return msgEntry(
    {
      role: "assistant",
      content: [{ type: "text", text }],
      stopReason: "end_turn",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, total: 0 },
      },
      timestamp: Number(id),
    } as unknown as AgentMessage,
    id,
  );
}

describe("parseSessionTitle", () => {
  it("takes the first line and strips surrounding quotes + trailing punctuation", () => {
    expect(parseSessionTitle('"Refactor auth"')).toBe("Refactor auth");
    expect(parseSessionTitle("`Add tests`")).toBe("Add tests");
    expect(parseSessionTitle("Fix the bug.")).toBe("Fix the bug");
    expect(parseSessionTitle("Update deps:")).toBe("Update deps");
    expect(parseSessionTitle("Title line\nextra line")).toBe("Title line");
  });

  it("clips long titles to TITLE_MAX with an ellipsis", () => {
    const long = "a".repeat(120);
    const out = parseSessionTitle(long);
    expect(out.length).toBe(60);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns empty string for blank input", () => {
    expect(parseSessionTitle("")).toBe("");
    expect(parseSessionTitle("   \n  ")).toBe("");
  });
});

describe("firstUserPrompt", () => {
  it("returns an empty string when the branch has no messages", () => {
    expect(firstUserPrompt([])).toBe("");
  });

  it("returns the first non-empty user message", () => {
    const branch: SessionEntry[] = [
      userEntry("Add a login page", "1"),
      assistantEntry("I created src/login.tsx", "2"),
      userEntry("Now add validation", "3"),
    ];
    expect(firstUserPrompt(branch)).toBe("Add a login page");
  });

  it("ignores leading assistant-only turns and skips empty user messages", () => {
    const branch: SessionEntry[] = [
      assistantEntry("hello", "1"),
      userEntry("   ", "2"),
      userEntry("Fix the off-by-one", "3"),
    ];
    expect(firstUserPrompt(branch)).toBe("Fix the off-by-one");
  });

  it("collapses internal whitespace and clips very long prompts", () => {
    const long = "do ".repeat(500).trim();
    const branch: SessionEntry[] = [userEntry(long, "1")];
    const out = firstUserPrompt(branch);
    expect(out.length).toBeLessThanOrEqual(800);
    expect(out.endsWith("…")).toBe(true);
    expect(out.includes("\n")).toBe(false);
  });
});
