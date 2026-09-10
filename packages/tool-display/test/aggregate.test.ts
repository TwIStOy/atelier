import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
  type AggregateMemberState,
  aggregateRailSpec,
  aggregateSubrowBodyWidth,
  aggregateSummary,
  isAggregateToolName,
  renderAggregateLine,
  renderAggregateSubrowLine,
} from "../src/aggregate.ts";

const PLAIN_THEME: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

const ANSI_CODES: Record<string, string> = { success: "32", error: "31" };
const ANSI_THEME: Theme = {
  fg: (color: string, text: string) => `\x1b[${ANSI_CODES[color]}m${text}\x1b[39m`,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function member(toolName: string, opts: { partial?: boolean; error?: boolean } = {}): AggregateMemberState {
  return { toolName, isPartial: opts.partial ?? false, isError: opts.error ?? false };
}

describe("isAggregateToolName", () => {
  it("accepts exactly the four read-only tools", () => {
    for (const name of ["grep", "glob", "ls", "read"]) {
      expect(isAggregateToolName(name)).toBe(true);
    }
    for (const name of ["bash", "edit", "write", "subagent", "todo_create", "web_search"]) {
      expect(isAggregateToolName(name)).toBe(false);
    }
  });
});

describe("aggregateSummary", () => {
  it("merges counts per tool type in first-appearance order", () => {
    const summary = aggregateSummary([
      member("read"),
      member("read"),
      member("grep"),
      member("read"),
      member("ls"),
      member("glob"),
    ]);
    expect(summary).toBe("Read 3 files, Searched 1 pattern, Listed 1 dir, Matched 1 glob");
  });

  it("uses singular nouns for a single call", () => {
    expect(aggregateSummary([member("read")])).toBe("Read 1 file");
    expect(aggregateSummary([member("grep")])).toBe("Searched 1 pattern");
    expect(aggregateSummary([member("ls")])).toBe("Listed 1 dir");
    expect(aggregateSummary([member("glob")])).toBe("Matched 1 glob");
  });

  it("uses plural nouns for multiple calls", () => {
    expect(aggregateSummary([member("grep"), member("grep")])).toBe("Searched 2 patterns");
    expect(aggregateSummary([member("ls"), member("ls"), member("ls")])).toBe("Listed 3 dirs");
    expect(aggregateSummary([member("glob"), member("glob")])).toBe("Matched 2 globs");
  });

  it("replaces the count phrase with a progressive phrase while a type is partial", () => {
    const summary = aggregateSummary([member("grep", { partial: true }), member("read")]);
    expect(summary).toBe("Searching…, Read 1 file");
  });

  it("keeps the progressive phrase when same-type calls mix partial and done", () => {
    const summary = aggregateSummary([
      member("grep"),
      member("grep", { partial: true }),
      member("read", { partial: true }),
    ]);
    expect(summary).toBe("Searching…, Reading…");
  });

  it("covers every tool type with its progressive phrase", () => {
    const summary = aggregateSummary([
      member("read", { partial: true }),
      member("grep", { partial: true }),
      member("ls", { partial: true }),
      member("glob", { partial: true }),
    ]);
    expect(summary).toBe("Reading…, Searching…, Listing…, Matching…");
  });

  it("ignores members outside the aggregate tool set", () => {
    expect(aggregateSummary([member("read"), member("bash")])).toBe("Read 1 file");
  });
});

describe("aggregateRailSpec", () => {
  it("marks completed groups green with the aggregate bullet", () => {
    const spec = aggregateRailSpec([member("read"), member("grep")], PLAIN_THEME, 0);
    expect(spec.mark).toBe("aggregate");
    expect(spec.bullet).toBe("◈");
    expect(spec.status).toBe("success");
  });

  it("marks the group red when any member errored", () => {
    const spec = aggregateRailSpec([member("read"), member("grep", { error: true })], PLAIN_THEME, 0);
    expect(spec.bullet).toBe("◈");
    expect(spec.status).toBe("error");
  });

  it("prefers the error state over a still-partial member", () => {
    const spec = aggregateRailSpec(
      [member("read", { partial: true }), member("grep", { error: true })],
      PLAIN_THEME,
      0,
    );
    expect(spec.bullet).toBe("◈");
    expect(spec.status).toBe("error");
  });

  it("uses a spinner bullet while any member is partial", () => {
    const spec = aggregateRailSpec([member("read"), member("grep", { partial: true })], PLAIN_THEME, 0);
    expect(spec.mark).toBe("aggregate");
    expect(SPINNER_FRAMES).toContain(spec.bullet);
    expect(spec.status).toBeUndefined();
  });
});

describe("renderAggregateLine", () => {
  it("renders the grok-style aggregate row", () => {
    const lines = renderAggregateLine([member("grep"), member("read"), member("read"), member("ls")], PLAIN_THEME, 80);
    expect(lines).toEqual(["  ❙  ◈ Searched 1 pattern, Read 2 files, Listed 1 dir"]);
  });

  it("switches the rail to the run mark while the group is expanded", () => {
    const lines = renderAggregateLine([member("read"), member("read")], PLAIN_THEME, 80, 0, true);
    expect(lines).toEqual(["  ┃  ◈ Read 2 files"]);
  });

  it("colors the rail and bullet red when a member errored", () => {
    const lines = renderAggregateLine([member("read"), member("grep", { error: true })], ANSI_THEME, 80);
    expect(lines[0]).toBe("  \x1b[31m❙\x1b[39m  \x1b[31m◈\x1b[39m Read 1 file, Searched 1 pattern");
  });

  it("colors the rail and bullet green on success", () => {
    const lines = renderAggregateLine([member("read"), member("read")], ANSI_THEME, 80);
    expect(lines[0]).toBe("  \x1b[32m❙\x1b[39m  \x1b[32m◈\x1b[39m Read 2 files");
  });

  it("renders a spinner bullet with an uncolored rail while partial", () => {
    const lines = renderAggregateLine([member("grep", { partial: true }), member("read")], ANSI_THEME, 80, 0);
    expect(stripTerminalSequences(lines[0])).toBe("  ❙  ⠋ Searching…, Read 1 file");
  });

  it("truncates the summary to the terminal width", () => {
    const members: AggregateMemberState[] = [];
    for (const tool of ["read", "grep", "ls", "glob"]) {
      for (let i = 0; i < 4; i++) members.push(member(tool));
    }
    const lines = renderAggregateLine(members, PLAIN_THEME, 40);
    expect(lines.length).toBe(1);
    expect(stripTerminalSequences(lines[0]).endsWith("…")).toBe(true);
    expect(visibleWidth(lines[0])).toBeLessThanOrEqual(40);
  });
});

describe("renderAggregateSubrowLine", () => {
  it("renders a subrow indented under the aggregate bullet", () => {
    const line = renderAggregateSubrowLine("Read packages/a.ts", "◆", "success", PLAIN_THEME, 80);
    expect(line).toBe("  ┃     ◆ Read packages/a.ts");
  });

  it("colors the rail and bullet with the member status", () => {
    const line = renderAggregateSubrowLine("Read packages/a.ts", "◆", "error", ANSI_THEME, 80);
    expect(line).toBe("  \x1b[31m┃\x1b[39m     \x1b[31m◆\x1b[39m Read packages/a.ts");
  });

  it("keeps the rail plain when the member has no status", () => {
    const line = renderAggregateSubrowLine("Searched", "⠋", undefined, ANSI_THEME, 80);
    expect(line).toBe("  ┃     ⠋ Searched");
  });

  it("truncates the subrow to the terminal width", () => {
    const header = "Grep ".repeat(30).trim();
    const line = renderAggregateSubrowLine(header, "◆", "success", PLAIN_THEME, 40);
    expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    expect(stripTerminalSequences(line).endsWith("…")).toBe(true);
  });

  it("exposes the subrow body width budget", () => {
    expect(aggregateSubrowBodyWidth(80)).toBe(70);
    expect(aggregateSubrowBodyWidth(12)).toBe(2);
    expect(aggregateSubrowBodyWidth(8)).toBe(0);
  });
});
