import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { childSessionIndexPath, recordChildSessionStarted } from "@htwang-contrib/common";
import { describe, expect, it, vi } from "vitest";
import type { SubagentRunSummary } from "../../src/viewer/index.ts";
import { SubagentViewerOverlay } from "../../src/viewer/overlay.ts";

initTheme(undefined, false);

function appendMsg(file: string, prevId: string | null, msg: unknown): string {
  const id = crypto.randomBytes(4).toString("hex");
  fs.appendFileSync(
    file,
    `${JSON.stringify({
      type: "message",
      id,
      parentId: prevId,
      timestamp: new Date().toISOString(),
      message: msg,
    })}\n`,
  );
  return id;
}

function makeChildSession(lines: number): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sub-scroll-"));
  const file = path.join(tmp, "child.jsonl");
  const header = {
    type: "session",
    version: 3,
    id: "h",
    timestamp: new Date().toISOString(),
    cwd: tmp,
    parentSession: "test-parent",
  };
  fs.appendFileSync(file, `${JSON.stringify(header)}\n`);
  // one user message followed by many assistant lines, linked as a chain
  // (each entry's parentId points at the previous entry — buildSessionContext
  // walks leaf→root via parentId, so a flat list with null parents would only
  // resolve to the single leaf).
  let prev: string | null = null;
  prev = appendMsg(file, prev, {
    role: "user",
    content: [{ type: "text", text: "go" }],
  });
  for (let i = 0; i < lines; i++) {
    prev = appendMsg(file, prev, {
      role: "assistant",
      content: [{ type: "text", text: `line ${i} of the transcript` }],
    });
  }
  return file;
}

function makeRun(file: string, running = false): SubagentRunSummary {
  return {
    id: "r",
    subSessionFile: file,
    toolCalls: 0,
    endedAt: "",
    startedAt: "",
    model: "",
    thinking: "",
    cwd: path.dirname(file),
    firstUserText: "go",
    label: "Run",
    running,
  };
}

function makeTui(rows: number): TUI {
  return {
    requestRender: vi.fn(),
    terminal: { rows, columns: 80 },
  } as unknown as TUI;
}

const THEME = {
  fg: (_c: string, t: string) => t,
  bg: (_c: string, t: string) => t,
} as unknown as Theme;

const ARROW_UP = "\u001b[A";
const ARROW_DOWN = "\u001b[B";

describe("SubagentViewerOverlay scroll + sticky-bottom", () => {
  it("opens pinned to the bottom (last line visible)", () => {
    const file = makeChildSession(40);
    try {
      const overlay = new SubagentViewerOverlay({
        tui: makeTui(10),
        theme: THEME,
        parentSessionId: "test-parent",
        runs: [makeRun(file)],
        initialIndex: 0,
        renderOptions: { expanded: true, hideThinkingBlock: false },
        onAction: () => {},
      });
      const view = overlay.render(80).join("\n");
      expect(view).toContain("line 39 of the transcript");
      overlay.dispose();
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("arrow up un-pins; G re-pins to the latest line", () => {
    const file = makeChildSession(40);
    try {
      const overlay = new SubagentViewerOverlay({
        tui: makeTui(10),
        theme: THEME,
        parentSessionId: "test-parent",
        runs: [makeRun(file)],
        initialIndex: 0,
        renderOptions: { expanded: true, hideThinkingBlock: false },
        onAction: () => {},
      });
      // scroll up several times -> last line should leave the viewport
      for (let i = 0; i < 12; i++) overlay.handleInput(ARROW_UP);
      const scrolled = overlay.render(80).join("\n");
      expect(scrolled).not.toContain("line 39 of the transcript");
      // G pins back to the bottom
      overlay.handleInput("G");
      const pinned = overlay.render(80).join("\n");
      expect(pinned).toContain("line 39 of the transcript");
      overlay.dispose();
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("scrolling back down to the bottom re-enables follow", () => {
    const file = makeChildSession(40);
    try {
      const overlay = new SubagentViewerOverlay({
        tui: makeTui(10),
        theme: THEME,
        parentSessionId: "test-parent",
        runs: [makeRun(file)],
        initialIndex: 0,
        renderOptions: { expanded: true, hideThinkingBlock: false },
        onAction: () => {},
      });
      for (let i = 0; i < 20; i++) overlay.handleInput(ARROW_UP); // away from bottom
      overlay.handleInput("G"); // re-pin via G to reset baseline
      expect(overlay.render(80).join("\n")).toContain("line 39 of the transcript");
      // unpin again, then scroll down to bottom -> follow re-enables
      for (let i = 0; i < 15; i++) overlay.handleInput(ARROW_UP);
      // now hammer down arrow past the end
      for (let i = 0; i < 60; i++) overlay.handleInput(ARROW_DOWN);
      expect(overlay.render(80).join("\n")).toContain("line 39 of the transcript");
      overlay.dispose();
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("when sticky, appending to the child file keeps the view at the latest line", () => {
    const file = makeChildSession(5);
    const sessionId = `test-scroll-live-${crypto.randomBytes(4).toString("hex")}`;
    recordChildSessionStarted(sessionId, {
      parentSessionFile: "",
      childSessionFile: file,
    });
    try {
      const overlay = new SubagentViewerOverlay({
        tui: makeTui(8),
        theme: THEME,
        parentSessionId: sessionId,
        runs: [makeRun(file, true)],
        initialIndex: 0,
        renderOptions: { expanded: true, hideThinkingBlock: false },
        onAction: () => {},
      });
      // baseline: last visible line is line 4
      expect(overlay.render(80).join("\n")).toContain("line 4 of the transcript");
      // simulate live growth: append many more assistant messages to disk,
      // chained off the current leaf so buildSessionContext still resolves the
      // full transcript (not just the new leaf).
      const lines = fs.readFileSync(file, "utf8").trim().split("\n");
      const lastEntry = JSON.parse(lines[lines.length - 1]!);
      let prev: string | null = typeof lastEntry.id === "string" ? lastEntry.id : null;
      for (let i = 5; i < 40; i++) {
        prev = appendMsg(file, prev, {
          role: "assistant",
          content: [{ type: "text", text: `line ${i} of the transcript` }],
        });
      }
      // force a live tick (normally driven by the interval)
      overlay.tickNow();
      // because we never scrolled up, view should follow the newest line
      expect(overlay.render(80).join("\n")).toContain("line 39 of the transcript");
      overlay.dispose();
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
      fs.rmSync(childSessionIndexPath(sessionId), { force: true });
    }
  });
});
