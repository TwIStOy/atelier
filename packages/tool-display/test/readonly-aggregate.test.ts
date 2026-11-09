import { fileURLToPath } from "node:url";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type * as Common from "@htwang-contrib/common";
import { setRailTailSpacing } from "@htwang-contrib/common/tool-rail";
import { describe, expect, it, vi } from "vitest";
import {
  activateExtension as activateThinkingExtension,
  click,
  emitAssistantUpdate,
  makeMessage,
  makeComponent as makeThinkingComponent,
} from "../../compact-thinking/test/harness.ts";
import extension from "../src/index.ts";
import { makeComponent, withResult } from "./helpers.ts";

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
  return {
    ...actual,
    isExtensionDisabled: () => false,
  };
});

process.env.PI_PACKAGE_DIR = fileURLToPath(
  new URL("../../../node_modules/@earendil-works/pi-coding-agent", import.meta.url),
);
initTheme("dark", false);

const PLAIN_THEME: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
} as Theme;

const SPINNER_FRAME_CLASS = `[${["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"].join("")}]`;

function activateExtension(): void {
  const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => void>>();
  const pi = {
    events: { on: vi.fn(), emit: vi.fn() },
    on: vi.fn((name: string, handler: (event: unknown, ctx: unknown) => void) => {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    }),
  };
  extension(pi as unknown as ExtensionAPI);
  const sessionStart = handlers.get("session_start")?.[0];
  if (!sessionStart) throw new Error("session_start handler not registered");
  sessionStart(undefined, { mode: "tui", ui: { theme: PLAIN_THEME } });
}

type FakeRoot = { children: unknown[] };

type PatchedComponent = {
  expanded: boolean;
  isPartial: boolean;
  __tdHovered?: boolean;
  result?: unknown;
  render(width: number): string[];
  handleMouse(event: { type: string; button: string; width: number; y?: number }): unknown;
};

function asPatched(component: ReturnType<typeof makeComponent>): PatchedComponent {
  return component as unknown as PatchedComponent;
}

describe("read-only tool aggregation", () => {
  it("renders the whole group red with the standard run rail when any member failed", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const grep1 = withResult(makeComponent("grep", root));
    const read1 = withResult(makeComponent("read", root), true);
    root.children.push(grep1, read1);

    expect(asPatched(grep1).render(80)).toEqual(["", "  ┃  ◈ Searched 1 pattern, Read 1 file · 1 failed"]);
    expect(asPatched(read1).render(80)).toEqual([]);
  });

  it("renders a spinner and progressive phrases while members are partial", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const grep1 = makeComponent("grep", root);
    const read1 = withResult(makeComponent("read", root));
    root.children.push(grep1, read1);

    const lines = asPatched(grep1).render(80);
    expect(lines.length).toBe(2);
    expect(lines[1]).toMatch(new RegExp(`^  ❙  ${SPINNER_FRAME_CLASS} Searching…, Read 1 file$`));
  });

  it("recovers to the green aggregate line once every member completes", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const grep1 = makeComponent("grep", root);
    const grep2 = makeComponent("grep", root);
    root.children.push(grep1, grep2);

    const streaming = asPatched(grep1).render(80);
    expect(streaming[1]).toMatch(new RegExp(`^  ❙  ${SPINNER_FRAME_CLASS} Searching…$`));

    withResult(grep2);
    const caughtUp = asPatched(grep1).render(80);
    expect(caughtUp[1]).toMatch(new RegExp(`^  ❙  ${SPINNER_FRAME_CLASS} Searching…$`));

    withResult(grep1);
    expect(asPatched(grep1).render(80)).toEqual(["", "  ❙  ◈ Searched 2 patterns"]);
  });

  it("groups history replay identically to the streamed session", () => {
    activateExtension();
    const streamedRoot: FakeRoot = { children: [] };
    const s1 = makeComponent("grep", streamedRoot);
    const s2 = makeComponent("read", streamedRoot);
    const s3 = makeComponent("read", streamedRoot);
    streamedRoot.children.push(s1, s2, s3);
    withResult(s2);
    withResult(s3);
    const streaming = asPatched(s1)
      .render(80)
      .map((line) => line.replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/, "⠿"));
    withResult(s1);
    const streamedFinal = asPatched(s1).render(80);

    const replayRoot: FakeRoot = { children: [] };
    const r1 = withResult(makeComponent("grep", replayRoot));
    const r2 = withResult(makeComponent("read", replayRoot));
    const r3 = withResult(makeComponent("read", replayRoot));
    replayRoot.children.push(r1, r2, r3);
    const replayed = asPatched(r1).render(80);

    expect(streaming).toEqual(["", "  ❙  ⠿ Searching…, Read 2 files"]);
    expect(streamedFinal).toEqual(replayed);
  });

  it("drops the leading blank line when the group follows another tool", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const bash1 = withResult(makeComponent("bash", root));
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(bash1, read1, read2);

    const lines = asPatched(read1).render(80);
    expect(lines[0]).toBe("  ❙  ◈ Read 2 files");
  });

  it("truncates the aggregate line to the terminal width", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const members: ReturnType<typeof makeComponent>[] = [];
    for (const tool of ["read", "grep", "ls", "glob"]) {
      for (let i = 0; i < 4; i++) {
        const component = withResult(makeComponent(tool, root));
        members.push(component);
        root.children.push(component);
      }
    }

    const lines = asPatched(members[0]).render(40);
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    }
    expect(stripTerminalSequences(lines[1]).endsWith("…")).toBe(true);
  });

  it("expands the group into a grok-style subrow list on a leader-line click", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root, { file_path: "packages/a.ts" }));
    const read2 = withResult(makeComponent("read", root, { file_path: "packages/b.ts" }));
    root.children.push(read1, read2);

    const leader = asPatched(read1);
    leader.render(80);
    expect(leader.handleMouse({ type: "click", button: "left", width: 80, y: 1 })).toEqual({ handled: true });
    expect(leader.expanded).toBe(false);
    expect(leader.render(80)).toEqual(["", "  ┃  ◈ Read 2 files", "  ┃     ◆ Read packages/a.ts"]);
    expect(asPatched(read2).render(80)).toEqual(["  ┃     ◆ Read packages/b.ts"]);
  });

  it("expands a single member to its full output and back via subrow clicks", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root, { file_path: "packages/a.ts" }));
    const read2 = withResult(makeComponent("read", root, { file_path: "packages/b.ts" }));
    root.children.push(read1, read2);

    const leader = asPatched(read1);
    leader.render(80);
    leader.handleMouse({ type: "click", button: "left", width: 80, y: 1 });

    const member = asPatched(read2);
    member.render(80);
    expect(member.handleMouse({ type: "click", button: "left", width: 80, y: 0 })).toEqual({ handled: true });
    expect(member.expanded).toBe(true);

    const memberLines = member.render(80).map((line) => stripTerminalSequences(line).trimEnd());
    expect(memberLines.length).toBeGreaterThan(1);
    expect(memberLines[0].indexOf("◆")).toBe(8);
    expect(memberLines.every((line) => line.startsWith("  ┃"))).toBe(true);
    expect(memberLines.join("\n")).toContain("Read packages/b.ts");
    expect(memberLines.join("\n")).toContain("done");
    for (const width of [12, 22, 40, 80]) {
      const lines = member.render(width).map((line) => stripTerminalSequences(line).trimEnd());
      expect(lines[0].indexOf("◆")).toBe(8);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
    expect(leader.render(80)).toEqual(["", "  ┃  ◈ Read 2 files", "  ┃     ◆ Read packages/a.ts"]);

    expect(member.handleMouse({ type: "click", button: "left", width: 80, y: 2 })).toEqual({ handled: true });
    expect(member.expanded).toBe(false);
    expect(member.render(80)).toEqual(["  ┃     ◆ Read packages/b.ts"]);
  });

  it("aligns thinking with tool subrows when its group expands", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const session = activateThinkingExtension({ tuiRoot: root });
    try {
      const read1 = withResult(makeComponent("read", root, { file_path: "packages/a.ts" }));
      const thinking = makeThinkingComponent(makeMessage([{ type: "thinking", thinking: "reasoning" }]));
      const read2 = withResult(makeComponent("read", root, { file_path: "packages/b.ts" }));
      root.children.push(read1, thinking, read2);

      const leader = asPatched(read1);
      leader.render(80);
      expect(thinking.render(80)).toEqual([]);
      leader.handleMouse({ type: "click", button: "left", width: 80, y: 1 });
      leader.render(80);

      expect(thinking.render(80).map((line) => stripTerminalSequences(line).trimEnd())).toEqual([
        "  ┃     ◆ Thinking...",
      ]);

      leader.handleMouse({ type: "click", button: "left", width: 80, y: 1 });
      expect(leader.render(80)).toEqual(["", "  ❙  ◈ Read 2 files"]);
      expect(thinking.render(80)).toEqual([]);
      expect(asPatched(read2).render(80)).toEqual([]);
    } finally {
      session.shutdown();
    }
  });

  it("keeps expanded thinking text aligned and complete when the group resizes", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const session = activateThinkingExtension({ tuiRoot: root });
    try {
      const read1 = withResult(makeComponent("read", root));
      const reasoning = "abcdefghijklmnopqrstuvwxyz中文内容";
      const thinking = makeThinkingComponent(makeMessage([{ type: "thinking", thinking: reasoning }]));
      const read2 = withResult(makeComponent("read", root));
      root.children.push(read1, thinking, read2);

      const leader = asPatched(read1);
      leader.render(80);
      leader.handleMouse({ type: "click", button: "left", width: 80, y: 1 });
      leader.render(80);
      expect(click(thinking, 0, thinking.render(80).length)).toMatchObject({ handled: true });

      for (const width of [12, 22, 40, 80]) {
        leader.render(width);
        const lines = thinking.render(width).map((line) => stripTerminalSequences(line).trimEnd());
        expect(lines[0].indexOf("◆")).toBe(8);
        expect(lines.every((line) => line.startsWith("  ┃"))).toBe(true);
        expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
        const body = lines.slice(lines.indexOf("  ┃") + 1);
        expect(body.map((line) => line.slice(10)).join("")).toBe(reasoning);
      }
      for (const width of [0, 1, 7, 10]) {
        leader.render(width);
        expect(thinking.render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
      }

      leader.render(80);
      leader.handleMouse({ type: "click", button: "left", width: 80, y: 1 });
      leader.render(80);
      const standalone = thinking.render(80).map((line) => stripTerminalSequences(line).trimEnd());
      expect(standalone[0].indexOf("◆")).toBe(5);
      expect(standalone.at(-1)).toBe(`  ┃    ${reasoning}`);
    } finally {
      session.shutdown();
    }
  });

  it("indents streaming thinking only while the surrounding group is expanded", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const session = activateThinkingExtension({ tuiRoot: root });
    try {
      const read1 = withResult(makeComponent("read", root));
      const message = makeMessage([{ type: "thinking", thinking: "reasoning" }]);
      emitAssistantUpdate(session, message, { type: "thinking_start", contentIndex: 0 });
      const thinking = makeThinkingComponent(message);
      const read2 = withResult(makeComponent("read", root));
      root.children.push(read1, thinking, read2);

      const leader = asPatched(read1);
      leader.render(80);
      expect(stripTerminalSequences(thinking.render(80)[0]).indexOf("◆")).toBe(5);
      leader.handleMouse({ type: "click", button: "left", width: 80, y: 1 });
      leader.render(80);
      const expanded = thinking.render(80).map((line) => stripTerminalSequences(line).trimEnd());
      expect(expanded[0].indexOf("◆")).toBe(8);
      expect(expanded.at(-1)).toBe("  ┃       reasoning");

      leader.handleMouse({ type: "click", button: "left", width: 80, y: 1 });
      leader.render(80);
      expect(stripTerminalSequences(thinking.render(80)[0]).indexOf("◆")).toBe(5);
    } finally {
      session.shutdown();
    }
  });

  it("expands the leader's own call through its subrow below the summary", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root, { file_path: "packages/a.ts" }));
    const read2 = withResult(makeComponent("read", root, { file_path: "packages/b.ts" }));
    root.children.push(read1, read2);

    const leader = asPatched(read1);
    leader.render(80);
    leader.handleMouse({ type: "click", button: "left", width: 80, y: 1 });
    expect(leader.handleMouse({ type: "click", button: "left", width: 80, y: 2 })).toEqual({ handled: true });
    expect(leader.expanded).toBe(true);

    const lines = leader.render(80);
    expect(lines[0]).toBe("");
    expect(lines[1]).toBe("  ┃  ◈ Read 2 files");
    expect(lines.length).toBeGreaterThan(2);
    const plain = lines.map((line) => stripTerminalSequences(line).trimEnd());
    expect(plain[2].indexOf("◆")).toBe(8);
    expect(plain.every((line) => line === "" || line.startsWith("  ┃"))).toBe(true);
    expect(lines.join("\n")).toContain("Read packages/a.ts");
    expect(lines.join("\n")).toContain("done");
    expect(asPatched(read2).render(80)).toEqual(["  ┃     ◆ Read packages/b.ts"]);
  });

  it("collapses the whole group back to the aggregate line on a second leader click", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root, { file_path: "packages/a.ts" }));
    const read2 = withResult(makeComponent("read", root, { file_path: "packages/b.ts" }));
    root.children.push(read1, read2);

    const leader = asPatched(read1);
    leader.render(80);
    leader.handleMouse({ type: "click", button: "left", width: 80, y: 1 });
    asPatched(read2).render(80);
    asPatched(read2).handleMouse({ type: "click", button: "left", width: 80, y: 0 });
    expect(asPatched(read2).expanded).toBe(true);

    expect(leader.handleMouse({ type: "click", button: "left", width: 80, y: 1 })).toEqual({ handled: true });
    expect(leader.render(80)).toEqual(["", "  ❙  ◈ Read 2 files"]);
    expect(asPatched(read2).render(80)).toEqual([]);
    expect(asPatched(read2).expanded).toBe(false);
    expect(leader.expanded).toBe(false);
  });

  it("ignores clicks on the separator line above the aggregate row", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, read2);

    const leader = asPatched(read1);
    leader.render(80);
    expect(leader.handleMouse({ type: "click", button: "left", width: 80, y: 0 })).toBeUndefined();
    expect(leader.render(80)).toEqual(["", "  ❙  ◈ Read 2 files"]);
  });

  it("toggles the group from the aggregate line that directly follows another tool", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const bash1 = withResult(makeComponent("bash", root));
    const read1 = withResult(makeComponent("read", root, { file_path: "packages/a.ts" }));
    const read2 = withResult(makeComponent("read", root, { file_path: "packages/b.ts" }));
    root.children.push(bash1, read1, read2);

    const leader = asPatched(read1);
    leader.render(80);
    expect(leader.handleMouse({ type: "click", button: "left", width: 80, y: 0 })).toEqual({ handled: true });
    expect(leader.render(80)).toEqual(["  ┃  ◈ Read 2 files", "  ┃     ◆ Read packages/a.ts"]);
  });

  it("toggles the group from the aggregate line that follows a rail-tail thinking block", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const thinking = { render: () => ["     ◆ Thought for 3s"] };
    setRailTailSpacing(thinking, 0);
    const read1 = withResult(makeComponent("read", root, { file_path: "packages/a.ts" }));
    const read2 = withResult(makeComponent("read", root, { file_path: "packages/b.ts" }));
    root.children.push(thinking, read1, read2);

    const leader = asPatched(read1);
    expect(leader.render(80)).toEqual(["  ❙  ◈ Read 2 files"]);
    expect(leader.handleMouse({ type: "click", button: "left", width: 80, y: 0 })).toEqual({ handled: true });
    expect(leader.render(80)).toEqual(["  ┃  ◈ Read 2 files", "  ┃     ◆ Read packages/a.ts"]);
  });

  it("ignores member subrow clicks before the result arrives", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root, { file_path: "packages/a.ts" }));
    const grep1 = makeComponent("grep", root, { pattern: "TODO" });
    root.children.push(read1, grep1);

    const leader = asPatched(read1);
    leader.render(80);
    leader.handleMouse({ type: "click", button: "left", width: 80, y: 1 });

    const member = asPatched(grep1);
    expect(member.render(80).length).toBe(1);
    expect(member.handleMouse({ type: "click", button: "left", width: 80, y: 0 })).toBeUndefined();
    expect(member.expanded).toBe(false);
    expect(member.render(80).length).toBe(1);
  });

  it("ignores non-left clicks on aggregate rows", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, read2);

    const leader = asPatched(read1);
    leader.render(80);
    expect(leader.handleMouse({ type: "click", button: "right", width: 80, y: 1 })).toBeUndefined();
    expect(leader.render(80)).toEqual(["", "  ❙  ◈ Read 2 files"]);
  });

  it("shows a subrow for members that join the group while expanded", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root, { file_path: "packages/a.ts" }));
    const read2 = withResult(makeComponent("read", root, { file_path: "packages/b.ts" }));
    root.children.push(read1, read2);

    const leader = asPatched(read1);
    leader.render(80);
    leader.handleMouse({ type: "click", button: "left", width: 80, y: 1 });
    asPatched(read2).render(80);
    asPatched(read2).handleMouse({ type: "click", button: "left", width: 80, y: 0 });
    expect(asPatched(read2).expanded).toBe(true);

    const read3 = withResult(makeComponent("read", root, { file_path: "packages/c.ts" }));
    root.children.push(read3);
    expect(leader.render(80)).toEqual(["", "  ┃  ◈ Read 3 files", "  ┃     ◆ Read packages/a.ts"]);
    const expanded = asPatched(read2)
      .render(80)
      .map((line) => stripTerminalSequences(line).trimEnd());
    expect(expanded[0].indexOf("◆")).toBe(8);
    expect(expanded.every((line) => line.startsWith("  ┃"))).toBe(true);
    expect(expanded.join("\n")).toContain("Read packages/b.ts");
    expect(asPatched(read3).render(80)).toEqual(["  ┃     ◆ Read packages/c.ts"]);
  });

  it("truncates subrow summaries to the terminal width", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const longPath = "packages/very/deeply/nested/directory/structure/with/a/long/file/name.ts";
    const read1 = withResult(makeComponent("read", root, { file_path: longPath }));
    const read2 = withResult(makeComponent("read", root, { file_path: `${longPath}2` }));
    root.children.push(read1, read2);

    const leader = asPatched(read1);
    leader.render(80);
    leader.handleMouse({ type: "click", button: "left", width: 80, y: 1 });

    for (const line of leader.render(30)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(30);
    }
    for (const line of asPatched(read2).render(30)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(30);
    }
  });

  it("keeps the aggregate bullet while hovered", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, read2);

    const leader = asPatched(read1);
    leader.render(80);
    expect(leader.handleMouse({ type: "move", button: "none", width: 80 })).toEqual({
      handled: true,
      render: true,
    });
    expect(leader.render(80)).toEqual(["", "  ❙  ◈ Read 2 files"]);
  });
});
