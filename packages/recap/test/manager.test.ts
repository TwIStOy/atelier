import type { Message } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { buildRecapPrompt, parseRecap } from "../src/manager.ts";

function userMessage(text: string): Message {
  return { role: "user", content: text, timestamp: 1_000 };
}

function assistantMessage(text: string): Message {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-haiku",
    timestamp: 2_000,
  } as Message;
}

describe("buildRecapPrompt", () => {
  it("wraps the serialized conversation in the recap instruction", () => {
    const prompt = buildRecapPrompt([userMessage("fix the login bug"), assistantMessage("done")]);

    expect(prompt).toContain("Create a short recap from this transcript");
    expect(prompt).toContain("<conversation>");
    expect(prompt).toContain("fix the login bug");
    expect(prompt).toContain("done");
    expect(prompt.trimEnd().endsWith("</conversation>")).toBe(true);
  });

  it("keeps only the tail when the transcript exceeds the budget", () => {
    const head = "H".repeat(10_000);
    const tail = "T".repeat(10);
    const prompt = buildRecapPrompt([userMessage(head), userMessage(tail)]);

    const conversation = prompt.split("<conversation>\n")[1]?.split("\n</conversation>")[0] ?? "";

    expect(conversation.length).toBe(8_000);
    expect(conversation.startsWith("T".repeat(10))).toBe(false);
    expect(conversation.endsWith(tail)).toBe(true);
  });
});

describe("parseRecap", () => {
  it("collapses newlines, tabs, and repeated spaces", () => {
    expect(parseRecap("You fixed\nthe login\tbug.  Tests pass.")).toBe("You fixed the login bug. Tests pass.");
  });

  it("strips wrapping quotes", () => {
    expect(parseRecap('"Recap text"')).toBe("Recap text");
    expect(parseRecap("`Recap text`")).toBe("Recap text");
  });

  it("returns empty string for blank input", () => {
    expect(parseRecap("")).toBe("");
    expect(parseRecap("   \n\t ")).toBe("");
  });

  it("clips oversized output to the max length", () => {
    const long = "x".repeat(1_000);
    const parsed = parseRecap(long);
    expect(parsed.length).toBe(399);
    expect(parsed).toBe("x".repeat(399));
  });
});
