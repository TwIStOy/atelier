import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type * as Common from "@htwang-contrib/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DURATION_ENTRY_TYPE } from "../src/durations.ts";
import { SUMMARY_ENTRY_TYPE } from "../src/summaries.ts";
import { activateExtension, click, DIM_THEME, emitAssistantUpdate, makeComponent, makeMessage } from "./harness.ts";

const mockConfig = vi.hoisted(() => ({ overrides: {} as Record<string, unknown> }));

vi.mock("@htwang-contrib/common/component-tree", async (importOriginal) => importOriginal<typeof Common>());

vi.mock("@htwang-contrib/common/config", async (importOriginal) => {
  const actual = await importOriginal<typeof Common>();
  return {
    ...actual,
    readConfig: (_name: string, schema: { defaults: Record<string, unknown> }) => ({
      ...schema.defaults,
      ...mockConfig.overrides,
    }),
    registerConfigItems: vi.fn(),
  };
});

vi.mock("@htwang-contrib/common/extension-disable", async (importOriginal) => {
  const actual = await importOriginal<typeof Common>();
  return { ...actual, isExtensionDisabled: () => false };
});

vi.mock("@htwang-contrib/common/frame-epoch", async (importOriginal) => importOriginal<typeof Common>());

vi.mock("@htwang-contrib/common/log", async (importOriginal) => {
  const actual = await importOriginal<typeof Common>();
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock("@htwang-contrib/common/model-resolve", async (importOriginal) => importOriginal<typeof Common>());
vi.mock("@htwang-contrib/common/session-cache", async (importOriginal) => importOriginal<typeof Common>());

vi.mock("@htwang-contrib/common/side-call", async (importOriginal) => {
  const actual = await importOriginal<typeof Common>();
  return { ...actual, executeSideCall: () => new Promise(() => {}) };
});

vi.mock("@htwang-contrib/common/tool-rail", async (importOriginal) => importOriginal<typeof Common>());

function durationEntry(messageTimestamp: number, contentIndex: number, durationMs: number) {
  return { type: "custom", customType: DURATION_ENTRY_TYPE, data: { messageTimestamp, contentIndex, durationMs } };
}

function summaryEntry(messageTimestamp: number, contentIndex: number, summary: string) {
  return { type: "custom", customType: SUMMARY_ENTRY_TYPE, data: { messageTimestamp, contentIndex, summary } };
}

afterEach(() => {
  mockConfig.overrides = {};
});

describe("completed thinking run single-line rendering", () => {
  it("renders a restored duration and summary as one rail line", () => {
    const session = activateExtension({
      entries: [durationEntry(42, 0, 5000), summaryEntry(42, 0, "Parsed the config schema")],
    });
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "internal reasoning" }]));
    const lines = component.render(80).map(stripTerminalSequences);
    expect(lines).toHaveLength(1);
    expect(lines[0].replace(/[ \t]+$/, "")).toBe("     ◆ Thought for 5s — Parsed the config schema");
    session.shutdown();
  });

  it("renders only the duration when no summary exists", () => {
    const session = activateExtension({ entries: [durationEntry(42, 0, 5000)] });
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "internal reasoning" }]));
    const lines = component.render(80).map(stripTerminalSequences);
    expect(lines[0].replace(/[ \t]+$/, "")).toBe("     ◆ Thought for 5s");
    session.shutdown();
  });

  it("colors the bullet dim and leaves the rail column empty on the single line", () => {
    const session = activateExtension({
      theme: DIM_THEME,
      entries: [durationEntry(42, 0, 5000), summaryEntry(42, 0, "Parsed the config schema")],
    });
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "internal reasoning" }]));
    const raw = component.render(80)[0];
    expect(raw).toContain("\x1b[90m◆\x1b[39m");
    expect(stripTerminalSequences(raw).replace(/[\t ]+$/, "")).toBe("     ◆ Thought for 5s — Parsed the config schema");
    session.shutdown();
  });

  it("truncates an over-wide summary line instead of wrapping", () => {
    const summary = "a very long summary".repeat(20);
    const session = activateExtension({
      entries: [durationEntry(42, 0, 5000), summaryEntry(42, 0, summary)],
    });
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "internal reasoning" }]));
    const lines = component.render(40);
    const runLine = lines[lines.length - 1];
    expect(lines).toHaveLength(1);
    expect(visibleWidth(runLine)).toBeLessThanOrEqual(40);
    expect(stripTerminalSequences(runLine).endsWith("…")).toBe(true);
    session.shutdown();
  });

  it("keeps the summarizing indicator on the single line while the side call is pending", () => {
    vi.useFakeTimers();
    mockConfig.overrides = { summaryEnabled: true };
    const session = activateExtension({
      ctx: { model: { id: "side-model", provider: "test" }, modelRegistry: { getAvailable: () => [] } },
    });
    try {
      const message = makeMessage([{ type: "thinking", thinking: "x".repeat(2100) }]);
      const component = makeComponent(message);
      emitAssistantUpdate(session, message, { type: "thinking_start", contentIndex: 0 });
      emitAssistantUpdate(session, message, { type: "text_start" });

      const lines = component.render(80).map(stripTerminalSequences);
      expect(lines).toHaveLength(1);
      expect(lines[0].replace(/[ \t]+$/, "")).toMatch(/^ {5}◆ Thought for \d+ms \[ Summarizing\.\.\. \]$/);
      expect(lines[0]).not.toContain("Summary:");
    } finally {
      session.shutdown();
      vi.useRealTimers();
    }
  });

  it("renders the expanded preview with a dim run rail on every row", () => {
    const session = activateExtension({
      theme: DIM_THEME,
      entries: [durationEntry(42, 0, 5000), summaryEntry(42, 0, "Parsed the config schema")],
    });
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "l1\nl2\nl3" }]));
    expect(click(component, 0, component.render(80).length)).toMatchObject({ handled: true });

    const lines = component.render(80);
    const railLine = lines[0].replace(/^\x1b\]133;[A-Z]\x07/, "");
    expect(railLine.startsWith("  \x1b[90m┃\x1b[39m  \x1b[90m◆\x1b[39m ")).toBe(true);
    const stripped = lines.map((line) => stripTerminalSequences(line).replace(/[ \t]+$/, ""));
    expect(stripped[0]).toBe("  ┃  ◆ Thought for 5s ... (click to collapse)");
    expect(stripped[1]).toBe("  ┃");
    expect(stripped[2]).toBe("  ┃    l1");
    expect(stripped[4]).toBe("  ┃    l3");
    expect(stripped.some((line) => line.includes("Parsed the config schema"))).toBe(false);
    session.shutdown();
  });
});
