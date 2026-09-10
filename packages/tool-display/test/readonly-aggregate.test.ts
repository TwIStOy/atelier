import { fileURLToPath } from "node:url";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type * as Common from "@htwang-contrib/common";
import { componentRendersLines } from "@htwang-contrib/common";
import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.ts";

vi.mock("@htwang-contrib/common", async (importOriginal) => {
  const actual = await importOriginal<typeof Common>();
  return {
    ...actual,
    isExtensionDisabled: () => false,
    registerConfigItems: vi.fn(),
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

let callSeq = 0;

function makeComponent(toolName: string, root: FakeRoot): ToolExecutionComponent {
  const toolDefinition: ToolDefinition = {
    name: toolName,
    label: toolName,
    description: "test tool",
    parameters: Type.Object({}),
    execute: async () => ({ content: [], details: {} }),
  };
  return new ToolExecutionComponent(
    toolName,
    `call-${toolName}-${callSeq++}`,
    {},
    {},
    toolDefinition,
    root as unknown as ConstructorParameters<typeof ToolExecutionComponent>[5],
    process.cwd(),
  );
}

function withResult(component: ToolExecutionComponent, isError = false): ToolExecutionComponent {
  component.updateResult({ content: [{ type: "text", text: isError ? "boom" : "done" }], details: {}, isError }, false);
  return component;
}

function textBlock(lines: string[]): { render: (width: number) => string[] } {
  return { render: () => lines };
}

type PatchedComponent = {
  expanded: boolean;
  __tdHovered?: boolean;
  render(width: number): string[];
  handleMouse(event: { type: string; button: string; width: number }): unknown;
};

function asPatched(component: ToolExecutionComponent): PatchedComponent {
  return component as unknown as PatchedComponent;
}

describe("read-only tool aggregation", () => {
  it("collapses consecutive read-only calls into one leader line and empty members", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    const grep1 = withResult(makeComponent("grep", root));
    root.children.push(read1, read2, grep1);

    expect(asPatched(read1).render(80)).toEqual(["", "  ❙  ◈ Read 2 files, Searched 1 pattern"]);
    expect(asPatched(read2).render(80)).toEqual([]);
    expect(asPatched(grep1).render(80)).toEqual([]);
  });

  it("merges same-type counts across interleaved types in first-appearance order", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    const grep1 = withResult(makeComponent("grep", root));
    const ls1 = withResult(makeComponent("ls", root));
    const glob1 = withResult(makeComponent("glob", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, grep1, ls1, glob1, read2);

    expect(asPatched(read1).render(80)).toEqual([
      "",
      "  ❙  ◈ Read 2 files, Searched 1 pattern, Listed 1 dir, Matched 1 glob",
    ]);
    expect(asPatched(grep1).render(80)).toEqual([]);
  });

  it("keeps a single read-only call on the normal ◆ line", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    root.children.push(read1);

    const lines = asPatched(read1).render(80);
    expect(lines.join("\n")).toContain("◆");
    expect(lines.join("\n")).toContain("Read");
    expect(lines.join("\n")).not.toContain("◈");
  });

  it("breaks the group on an assistant text block between two reads", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, textBlock(["assistant text"]), read2);

    const first = asPatched(read1).render(80).join("\n");
    const second = asPatched(read2).render(80).join("\n");
    expect(first).toContain("◆");
    expect(first).toContain("Read");
    expect(second).toContain("◆");
    expect(second).toContain("Read");
    expect(first).not.toContain("◈");
    expect(second).not.toContain("◈");
  });

  it("breaks the group on a user message component", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const grep1 = withResult(makeComponent("grep", root));
    const grep2 = withResult(makeComponent("grep", root));
    root.children.push(grep1, textBlock(["  user message"]), grep2);

    expect(asPatched(grep1).render(80).join("\n")).not.toContain("◈");
    expect(asPatched(grep2).render(80).join("\n")).not.toContain("◈");
  });

  it("breaks the group when another tool sits between two reads", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    const bash1 = withResult(makeComponent("bash", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, bash1, read2);

    expect(asPatched(read1).render(80).join("\n")).not.toContain("◈");
    expect(asPatched(read2).render(80).join("\n")).not.toContain("◈");
  });

  it("does not overflow when a previous sibling probes this tool from render", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    const thinking = {
      render(width: number) {
        return componentRendersLines(read1, width) ? ["     ◆ Thought for 3s"] : [];
      },
    };
    root.children.push(thinking, read1, read2);

    expect(asPatched(read1).render(80)).toEqual(["", "  ❙  ◈ Read 2 files"]);
    expect(asPatched(read2).render(80)).toEqual([]);
  });

  it("skips zero-line siblings instead of breaking the group", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, textBlock([]), read2);

    expect(asPatched(read1).render(80)).toEqual(["", "  ❙  ◈ Read 2 files"]);
  });

  it("breaks the group around an expanded member", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    const read3 = withResult(makeComponent("read", root));
    root.children.push(read1, read2, read3);
    read2.setExpanded(true);

    expect(asPatched(read1).render(80).join("\n")).toContain("◆");
    expect(asPatched(read2).render(80).join("\n")).toContain("Read");
    expect(asPatched(read3).render(80).join("\n")).toContain("◆");
    expect(asPatched(read3).render(80).join("\n")).not.toContain("◈");
  });

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

  it("re-elects the same leader on every frame", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    const grep1 = withResult(makeComponent("grep", root));
    root.children.push(read1, grep1);

    const first = asPatched(read1).render(80);
    const second = asPatched(read1).render(80);
    expect(first).toEqual(second);
    expect(asPatched(grep1).render(80)).toEqual([]);
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
    const members: ToolExecutionComponent[] = [];
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

  it("does not expand the aggregate line on left click", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, read2);

    const leader = asPatched(read1);
    leader.render(80);
    expect(leader.handleMouse({ type: "click", button: "left", width: 80 })).toBeUndefined();
    expect(leader.expanded).toBe(false);
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
