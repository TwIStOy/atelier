import { stripTerminalSequences } from "@earendil-works/pi-tui";
import type * as Common from "@htwang-contrib/common";
import { describe, expect, it, vi } from "vitest";
import { DURATION_ENTRY_TYPE } from "../src/durations.ts";
import { activateExtension, emitAssistantUpdate, makeComponent, makeMessage, PLAIN_THEME } from "./harness.ts";

vi.mock("@htwang-contrib/common/component-tree", async (importOriginal) => importOriginal<typeof Common>());

vi.mock("@htwang-contrib/common/config", async (importOriginal) => {
  const actual = await importOriginal<typeof Common>();
  return {
    ...actual,
    readConfig: (_name: string, schema: { defaults: Record<string, unknown> }) => ({ ...schema.defaults }),
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
vi.mock("@htwang-contrib/common/tool-rail", async (importOriginal) => importOriginal<typeof Common>());

function renderActive(content: Array<{ type: string; thinking?: string; text?: string }>): string[] {
  const session = activateExtension({ theme: PLAIN_THEME });
  try {
    const message = makeMessage(content as Parameters<typeof makeMessage>[0]);
    const component = makeComponent(message);
    emitAssistantUpdate(session, message, { type: "thinking_start", contentIndex: 0 });
    return component.render(80).map((line) => stripTerminalSequences(line).replace(/[ \t]+$/, ""));
  } finally {
    session.shutdown();
  }
}

describe("active thinking run preview", () => {
  it("renders the heading and the last three thinking lines", () => {
    const lines = renderActive([{ type: "thinking", thinking: "l1\nl2\nl3\nl4\nl5" }]);
    expect(lines).toEqual(["  ┃  ◆ Thinking... · 1ms", "  ┃    l3", "  ┃    l4", "  ┃    l5"]);
  });

  it("renders every line when the thinking text is shorter than the preview budget", () => {
    const lines = renderActive([{ type: "thinking", thinking: "l1\nl2" }]);
    expect(lines).toEqual(["  ┃  ◆ Thinking... · 1ms", "  ┃    l1", "  ┃    l2"]);
  });

  it("keeps the single-line heading when no thinking text has streamed yet", () => {
    const lines = renderActive([{ type: "thinking", thinking: "  \n " }]);
    expect(lines).toEqual(["  ┃  ◆ Thinking... · 1ms"]);
  });

  it("renders completed runs single-line while the active run keeps its preview", () => {
    vi.useFakeTimers();
    const session = activateExtension({
      theme: PLAIN_THEME,
      entries: [
        {
          type: "custom",
          customType: DURATION_ENTRY_TYPE,
          data: { messageTimestamp: 42, contentIndex: 0, durationMs: 5000 },
        },
      ],
    });
    try {
      const message = makeMessage([
        { type: "thinking", thinking: "done1\ndone2" },
        { type: "text", text: "middle" },
        { type: "thinking", thinking: "live1\nlive2\nlive3\nlive4" },
      ]);
      const component = makeComponent(message);
      emitAssistantUpdate(session, message, { type: "thinking_start", contentIndex: 2 });
      const lines = component.render(80).map((line) => stripTerminalSequences(line).replace(/[ \t]+$/, ""));
      expect(lines).toEqual([
        "     ◆ Thought for 5s",
        "",
        " middle",
        "",
        "  ┃  ◆ Thinking... · 1ms",
        "  ┃    live2",
        "  ┃    live3",
        "  ┃    live4",
      ]);
    } finally {
      session.shutdown();
      vi.useRealTimers();
    }
  });

  it("collapses back to the single-line heading once the run finishes", () => {
    const session = activateExtension({ theme: PLAIN_THEME });
    try {
      const message = makeMessage([{ type: "thinking", thinking: "l1\nl2\nl3\nl4\nl5" }]);
      const component = makeComponent(message);
      emitAssistantUpdate(session, message, { type: "thinking_start", contentIndex: 0 });
      emitAssistantUpdate(session, message, { type: "text_start" });
      const lines = component.render(80).map((line) => stripTerminalSequences(line).replace(/[ \t]+$/, ""));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^ {5}◆ Thought for \d+ms$/);
    } finally {
      session.shutdown();
    }
  });
});
