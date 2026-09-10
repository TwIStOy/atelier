import type { AssistantMessageComponent, Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import type * as Common from "@htwang-contrib/common";
import { describe, expect, it, vi } from "vitest";
import { activateExtension, click, emitAssistantUpdate, makeComponent, makeMessage, PLAIN_THEME } from "./harness.ts";

vi.mock("@htwang-contrib/common", async (importOriginal) => {
  const actual = await importOriginal<typeof Common>();
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    isExtensionDisabled: () => false,
    readConfig: (_name: string, schema: { defaults: Record<string, unknown> }) => ({ ...schema.defaults }),
    registerConfigItems: vi.fn(),
  };
});

const WAVE_THEME: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
  getFgAnsi: (color: string) => {
    if (color === "borderMuted") return "\x1b[38;2;80;80;80m";
    if (color === "text") return "\x1b[38;2;212;212;212m";
    throw new Error(`unexpected fg color: ${color}`);
  },
  getColorMode: () => "truecolor",
} as unknown as Theme;

const TICK_MS = 45;

function startActiveRun(theme: Theme) {
  const session = activateExtension({ theme });
  const message = makeMessage([{ type: "thinking", thinking: "streaming thought" }]);
  const component = makeComponent(message);
  emitAssistantUpdate(session, message, { type: "thinking_start", contentIndex: 0 });
  return { session, message, component };
}

describe("active thinking run rail wave", () => {
  it("renders the static bar fallback in the rail column for themes without color accessors", () => {
    vi.useFakeTimers();
    const { session, component } = startActiveRun(PLAIN_THEME);
    try {
      const lines = component.render(80).map(stripTerminalSequences);
      expect(lines).toHaveLength(2);
      expect(lines[0].replace(/[ \t]+$/, "")).toBe("  ▌  ◆ Thinking... · 1ms");
      expect(lines[1].replace(/[ \t]+$/, "")).toBe("  ▌    streaming thought");
    } finally {
      session.shutdown();
      vi.useRealTimers();
    }
  });

  it("renders the wave trough exactly at frame 0", () => {
    vi.useFakeTimers();
    const { session, component } = startActiveRun(WAVE_THEME);
    try {
      const line = component.render(80)[0];
      expect(line).toContain("  \x1b[38;2;80;80;80m▌\x1b[39m  ◆ Thinking...");
    } finally {
      session.shutdown();
      vi.useRealTimers();
    }
  });

  it("scales the wave amplitude with the real row count", () => {
    vi.useFakeTimers();
    const { session, component } = startActiveRun(WAVE_THEME);
    try {
      vi.advanceTimersByTime(8 * TICK_MS);
      const line = component.render(80)[0];
      // brightness at frame 8, row 0 = (2/13)·sin²(8·2π·45/1400) ≈ 0.1535,
      // lerp(80, 212, 0.1535) ≈ 100.27 → 100. The active block renders the
      // heading plus preview lines, so the amplitude follows the actual height.
      expect(line).toContain("  \x1b[38;2;100;100;100m▌\x1b[39m  ◆ Thinking...");
    } finally {
      session.shutdown();
      vi.useRealTimers();
    }
  });
});

describe("animation tick rebuild cadence", () => {
  it("rebuilds the collapsed run once every two ticks", () => {
    vi.useFakeTimers();
    const { session, component } = startActiveRun(PLAIN_THEME);
    try {
      const spy = vi.spyOn(component as unknown as AssistantMessageComponent, "updateContent");
      vi.advanceTimersByTime(2 * TICK_MS);
      expect(spy).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2 * TICK_MS);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      session.shutdown();
      vi.useRealTimers();
    }
  });

  it("never rebuilds an expanded run from the tick", () => {
    vi.useFakeTimers();
    const { session, component } = startActiveRun(PLAIN_THEME);
    try {
      expect(click(component, 0, component.render(80).length)).toMatchObject({ handled: true });
      const spy = vi.spyOn(component as unknown as AssistantMessageComponent, "updateContent");
      vi.advanceTimersByTime(6 * TICK_MS);
      expect(spy).not.toHaveBeenCalled();
      expect(component.render(80).join("\n")).toContain("streaming thought");

      expect(click(component, 0, component.render(80).length)).toMatchObject({ handled: true });
      spy.mockClear();
      vi.advanceTimersByTime(2 * TICK_MS);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      session.shutdown();
      vi.useRealTimers();
    }
  });
});
