import { describe, expect, test } from "vitest";
import type { BtwTurn } from "../src/btw-ui.ts";
import { BtwOverlayController } from "../src/btw-ui.ts";

function makeTurn(question: string, answer: string): BtwTurn {
  return {
    userMessage: {
      role: "user",
      content: question,
      timestamp: Date.now(),
    } as import("@earendil-works/pi-ai").UserMessage,
    assistantMessage: {
      role: "assistant",
      content: [{ type: "text", text: answer }],
    } as unknown as import("@earendil-works/pi-ai").AssistantMessage,
  };
}

function makeController(opts: { question?: string; history?: BtwTurn[]; termRows?: number } = {}) {
  let requestRenderCount = 0;
  const controller = new AbortController();
  const doneCalls: unknown[] = [];
  const clearHistoryCalls: number[] = [];
  const history = opts.history ?? [];

  const ctrl = new BtwOverlayController(
    {
      terminal: { rows: opts.termRows ?? 50 },
      requestRender: () => {
        requestRenderCount++;
      },
    } as unknown as import("@earendil-works/pi-tui").TUI,
    {
      fg: (_color: string, text: string) => `<${_color}>${text}</>`,
      bg: (_color: string, text: string) => `<bg:${_color}>${text}</>`,
    } as unknown as import("@earendil-works/pi-coding-agent").Theme,
    opts.question ?? "what is 2+2?",
    history,
    controller,
    () => {
      clearHistoryCalls.push(history.length);
    },
    () => {
      doneCalls.push(undefined);
    },
  );

  return {
    ctrl,
    controller,
    doneCalls,
    clearHistoryCalls,
    history,
    requestRenderCount: () => requestRenderCount,
  };
}

describe("BtwOverlayController", () => {
  describe("initial render", () => {
    test("shows banner, echo, pending glyph, dismiss footer", () => {
      const { ctrl } = makeController();
      const lines = ctrl.render(80);

      const banner = lines.find((l) => l.includes("/btw") && l.includes("what is 2+2?"));
      expect(banner).toBeDefined();

      const echo = lines.find((l) => l.includes("accent"));
      expect(echo).toBeDefined();

      const pending = lines.find((l) => l.includes("Working"));
      expect(pending).toBeDefined();

      const footer = lines.find((l) => l.includes("dismiss"));
      expect(footer).toBeDefined();
    });

    test("shows history lines when history is present", () => {
      const { ctrl } = makeController({
        history: [makeTurn("previous q", "previous a")],
      });
      const lines = ctrl.render(80);
      const historyLine = lines.find((l) => l.includes("previous q"));
      expect(historyLine).toBeDefined();
    });
  });

  describe("setAnswer", () => {
    test("replaces pending with answer text", () => {
      const { ctrl } = makeController();
      ctrl.setAnswer("The answer is 4.");
      const lines = ctrl.render(80);

      const answerLine = lines.find((l) => l.includes("The answer is 4."));
      expect(answerLine).toBeDefined();

      const pending = lines.find((l) => l.trim() === "…");
      expect(pending).toBeUndefined();
    });
  });

  describe("setError", () => {
    test("renders error text", () => {
      const { ctrl } = makeController();
      ctrl.setError("Something went wrong");
      const lines = ctrl.render(80);

      const errorLine = lines.find((l) => l.includes("Something went wrong"));
      expect(errorLine).toBeDefined();
    });
  });

  describe("handleInput", () => {
    test("Esc aborts controller and calls done()", () => {
      const { ctrl, controller, doneCalls } = makeController();
      ctrl.handleInput("\x1b");
      expect(controller.signal.aborted).toBe(true);
      expect(doneCalls).toHaveLength(1);
    });

    test("x clears history and invokes callback", () => {
      const history = [makeTurn("q1", "a1"), makeTurn("q2", "a2")];
      const { ctrl, clearHistoryCalls } = makeController({ history });
      ctrl.handleInput("x");
      expect(history).toHaveLength(0);
      expect(clearHistoryCalls).toHaveLength(1);
    });

    test("x does nothing when history is empty", () => {
      const { ctrl, clearHistoryCalls } = makeController({ history: [] });
      ctrl.handleInput("x");
      expect(clearHistoryCalls).toHaveLength(0);
    });
  });

  describe("scroll clipping", () => {
    test("returns all lines when content fits", () => {
      const { ctrl } = makeController({ termRows: 50 });
      ctrl.setAnswer("short answer");
      const lines = ctrl.render(80);
      expect(lines.length).toBeLessThan(50);
    });

    test("returns maxRows lines when content overflows", () => {
      const longAnswer = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join("\n");
      const { ctrl } = makeController({ termRows: 20 });
      ctrl.setAnswer(longAnswer);
      const lines = ctrl.render(80);
      const maxRows = Math.floor(20 * 0.85);
      expect(lines).toHaveLength(maxRows);
    });

    test("scroll down shifts visible window", () => {
      const longAnswer = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join("\n");
      const { ctrl } = makeController({ termRows: 20 });
      ctrl.setAnswer(longAnswer);
      const before = ctrl.render(80);
      ctrl.handleInput("\x1b[B");
      const after = ctrl.render(80);
      expect(after).not.toEqual(before);
    });

    test("scroll up clamps at zero", () => {
      const { ctrl } = makeController({ termRows: 20 });
      ctrl.setAnswer("some answer");
      const before = ctrl.render(80);
      ctrl.handleInput("\x1b[A");
      const after = ctrl.render(80);
      expect(after).toEqual(before);
    });
  });

  describe("banner", () => {
    test("is padded to full visible width", () => {
      const { ctrl } = makeController({ question: "hi" });
      const lines = ctrl.render(80);
      const banner = lines[0];
      expect(banner).toContain("bg:");
      expect(banner.length).toBeGreaterThanOrEqual(80);
    });
  });

  describe("footer", () => {
    test("shows clear history hint when history present", () => {
      const { ctrl } = makeController({
        history: [makeTurn("q", "a")],
      });
      const lines = ctrl.render(80);
      const footer = lines.find((l) => l.includes("clear history"));
      expect(footer).toBeDefined();
    });

    test("hides clear history hint when no history", () => {
      const { ctrl } = makeController({ history: [] });
      const lines = ctrl.render(80);
      const footer = lines.find((l) => l.includes("clear history"));
      expect(footer).toBeUndefined();
    });

    test("shows scroll hint after answer arrives", () => {
      const { ctrl } = makeController();
      ctrl.setAnswer("answer");
      const lines = ctrl.render(80);
      const footer = lines.find((l) => l.includes("scroll"));
      expect(footer).toBeDefined();
    });

    test("hides scroll hint while pending", () => {
      const { ctrl } = makeController();
      const lines = ctrl.render(80);
      const footer = lines.find((l) => l.includes("scroll"));
      expect(footer).toBeUndefined();
    });
  });
});
