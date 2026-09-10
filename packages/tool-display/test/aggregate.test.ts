import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
  type AggregateMemberState,
  aggregateRailSpec,
  aggregateSummary,
  isAggregateToolName,
  renderAggregateLine,
} from "../src/aggregate.ts";

const PLAIN_THEME: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

const ANSI_CODES: Record<string, string> = { success: "32", error: "31", dim: "90" };
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
  it("marks completed groups with a dim aggregate rail and a green bullet", () => {
    const spec = aggregateRailSpec([member("read"), member("grep")], PLAIN_THEME, 0);
    expect(spec.mark).toBe("aggregate");
    expect(spec.bullet).toBe("◈");
    expect(spec.status).toBe("success");
    expect(spec.railStatus).toBe("dim");
  });

  it("switches to the standard run rail in red when any member errored", () => {
    const spec = aggregateRailSpec([member("read"), member("grep", { error: true })], PLAIN_THEME, 0);
    expect(spec.mark).toBe("run");
    expect(spec.bullet).toBe("◈");
    expect(spec.status).toBe("error");
    expect(spec.railStatus).toBeUndefined();
  });

  it("prefers the error state over a still-partial member", () => {
    const spec = aggregateRailSpec(
      [member("read", { partial: true }), member("grep", { error: true })],
      PLAIN_THEME,
      0,
    );
    expect(spec.mark).toBe("run");
    expect(spec.bullet).toBe("◈");
    expect(spec.status).toBe("error");
  });

  it("uses a spinner bullet with a dim aggregate rail while any member is partial", () => {
    const spec = aggregateRailSpec([member("read"), member("grep", { partial: true })], PLAIN_THEME, 0);
    expect(spec.mark).toBe("aggregate");
    expect(SPINNER_FRAMES).toContain(spec.bullet);
    expect(spec.status).toBeUndefined();
    expect(spec.railStatus).toBe("dim");
  });
});

describe("renderAggregateLine", () => {
  it("renders the grok-style aggregate row", () => {
    const lines = renderAggregateLine([member("grep"), member("read"), member("read"), member("ls")], PLAIN_THEME, 80);
    expect(lines).toEqual(["  ❙  ◈ Searched 1 pattern, Read 2 files, Listed 1 dir"]);
  });

  it("renders the standard red run rail, red bullet, and failed suffix when a member errored", () => {
    const lines = renderAggregateLine([member("read"), member("grep", { error: true })], ANSI_THEME, 80);
    expect(lines[0]).toBe(
      "  \x1b[31m┃\x1b[39m  \x1b[31m◈\x1b[39m Read 1 file, Searched 1 pattern \x1b[31m· 1 failed\x1b[39m",
    );
  });

  it("counts every errored member in the failed suffix", () => {
    const lines = renderAggregateLine(
      [member("read", { error: true }), member("read", { error: true }), member("grep")],
      PLAIN_THEME,
      80,
    );
    expect(lines).toEqual(["  ┃  ◈ Read 2 files, Searched 1 pattern · 2 failed"]);
  });

  it("renders a dim rail with a green bullet on success", () => {
    const lines = renderAggregateLine([member("read"), member("read")], ANSI_THEME, 80);
    expect(lines[0]).toBe("  \x1b[90m❙\x1b[39m  \x1b[32m◈\x1b[39m Read 2 files");
  });

  it("renders a spinner bullet with a dim rail while partial", () => {
    const lines = renderAggregateLine([member("grep", { partial: true }), member("read")], ANSI_THEME, 80, 0);
    expect(lines[0]).toContain("\x1b[90m❙\x1b[39m");
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
