import type { AssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  extractThinkingRun,
  getRunSummary,
  restoreSummaryEntries,
  SUMMARY_ENTRY_TYPE,
  storeRunSummary,
} from "../src/summaries.ts";
import { clipThinkingInput, parseThinkingSummary } from "../src/summary.ts";

function makeMessage(content: AssistantMessage["content"]): AssistantMessage {
  return { role: "assistant", content, timestamp: 42 } as unknown as AssistantMessage;
}

describe("extractThinkingRun", () => {
  it("collects the contiguous thinking run ending at endIndex", () => {
    const message = makeMessage([
      { type: "text", text: "before" },
      { type: "thinking", thinking: "first block" },
      { type: "thinking", thinking: "second block" },
      { type: "text", text: "after" },
    ]);
    expect(extractThinkingRun(message, 2)).toBe("first block\n\nsecond block");
  });

  it("stops at the previous non-thinking content", () => {
    const message = makeMessage([
      { type: "thinking", thinking: "earlier run" },
      { type: "text", text: "between" },
      { type: "thinking", thinking: "later run" },
    ]);
    expect(extractThinkingRun(message, 2)).toBe("later run");
  });

  it("skips empty thinking blocks and trims", () => {
    const message = makeMessage([
      { type: "thinking", thinking: "   " },
      { type: "thinking", thinking: "  real content  " },
    ]);
    expect(extractThinkingRun(message, 1)).toBe("real content");
  });

  it("returns empty string when endIndex is not thinking content", () => {
    const message = makeMessage([{ type: "text", text: "only text" }]);
    expect(extractThinkingRun(message, 0)).toBe("");
  });
});

describe("getRunSummary", () => {
  it("finds a summary stored at any index within the run", () => {
    const summaries = new Map<number, Map<number, string>>();
    storeRunSummary(summaries, 42, 5, "summary text");
    expect(getRunSummary(summaries, 42, 3, 5)).toBe("summary text");
    expect(getRunSummary(summaries, 42, 5, 5)).toBe("summary text");
    expect(getRunSummary(summaries, 42, 6, 8)).toBeUndefined();
  });

  it("prefers the summary stored at the highest index in the run", () => {
    const summaries = new Map<number, Map<number, string>>();
    storeRunSummary(summaries, 42, 3, "older");
    storeRunSummary(summaries, 42, 5, "newer");
    expect(getRunSummary(summaries, 42, 3, 5)).toBe("newer");
  });

  it("returns undefined for unknown messages", () => {
    const summaries = new Map<number, Map<number, string>>();
    expect(getRunSummary(summaries, 999, 0, 5)).toBeUndefined();
  });
});

describe("restoreSummaryEntries", () => {
  it("restores valid summary entries", () => {
    const summaries = new Map<number, Map<number, string>>();
    restoreSummaryEntries(
      [
        {
          type: "custom",
          customType: SUMMARY_ENTRY_TYPE,
          data: { messageTimestamp: 1, contentIndex: 2, summary: "s" },
        },
      ],
      summaries,
    );
    expect(getRunSummary(summaries, 1, 0, 2)).toBe("s");
  });

  it("clears existing summaries before restoring", () => {
    const summaries = new Map<number, Map<number, string>>();
    storeRunSummary(summaries, 7, 0, "stale");
    restoreSummaryEntries([], summaries);
    expect(summaries.size).toBe(0);
  });

  it("skips malformed entries", () => {
    const summaries = new Map<number, Map<number, string>>();
    restoreSummaryEntries(
      [
        { type: "custom", customType: "other-entry", data: { messageTimestamp: 1, contentIndex: 2, summary: "s" } },
        {
          type: "custom",
          customType: SUMMARY_ENTRY_TYPE,
          data: { messageTimestamp: 1, contentIndex: 2, summary: " " },
        },
        {
          type: "custom",
          customType: SUMMARY_ENTRY_TYPE,
          data: { messageTimestamp: 1, contentIndex: 1.5, summary: "s" },
        },
        { type: "custom", customType: SUMMARY_ENTRY_TYPE, data: null },
        { type: "message", data: { messageTimestamp: 1, contentIndex: 2, summary: "s" } },
      ],
      summaries,
    );
    expect(summaries.size).toBe(0);
  });
});

describe("parseThinkingSummary", () => {
  it("takes the first line and strips surrounding quotes and trailing period", () => {
    expect(parseThinkingSummary('  "Decided to refactor the parser."\nextra line')).toBe(
      "Decided to refactor the parser",
    );
  });

  it("caps overly long summaries", () => {
    const long = "x".repeat(500);
    const parsed = parseThinkingSummary(long);
    expect(parsed.length).toBeLessThanOrEqual(240);
    expect(parsed.endsWith("…")).toBe(true);
  });

  it("returns empty string for blank answers", () => {
    expect(parseThinkingSummary("   \n  ")).toBe("");
  });
});

describe("clipThinkingInput", () => {
  it("returns short input unchanged", () => {
    expect(clipThinkingInput("short text", 100)).toBe("short text");
  });

  it("clips long input keeping head and tail with an omission marker", () => {
    const text = `h${"a".repeat(1000)}z`;
    const clipped = clipThinkingInput(text, 100);
    expect(clipped.startsWith("h")).toBe(true);
    expect(clipped.endsWith("z")).toBe(true);
    expect(clipped).toContain("characters omitted");
  });
});
