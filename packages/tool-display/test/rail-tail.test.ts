import { fileURLToPath } from "node:url";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import type * as Common from "@htwang-contrib/common";
import { readRailTailSpacing, setRailTailSpacing } from "@htwang-contrib/common/tool-rail";
import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.ts";

vi.mock("@htwang-contrib/common/config", async (importOriginal) => {
  const actual = await importOriginal<typeof Common>();
  return {
    ...actual,
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

function withResult(component: ToolExecutionComponent): ToolExecutionComponent {
  component.updateResult({ content: [{ type: "text", text: "done" }], details: {}, isError: false }, false);
  return component;
}

function thinkingTail(spacing: number): { render: (width: number) => string[] } {
  const tail = { render: () => ["     ◆ Thought for 3s"] };
  setRailTailSpacing(tail, spacing);
  return tail;
}

function textBlock(lines: string[]): { render: (width: number) => string[] } {
  return { render: () => lines };
}

function render(component: ToolExecutionComponent): string[] {
  return (component as unknown as { render(width: number): string[] }).render(80).map(stripTerminalSequences);
}

describe("rail-tail spacing handoff", () => {
  it("drops the leading blank when the sibling above is a thinking rail tail with 0 spacing", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(thinkingTail(0), read1, read2);

    expect(readRailTailSpacing(root.children[0])).toBe(0);
    expect(render(read1)).toEqual(["  ❙  ◈ Read 2 files"]);
    expect(render(read2)).toEqual([]);
  });

  it("lets the marked spacing own the gap instead of adding its own blank", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const bash1 = withResult(makeComponent("bash", root));
    root.children.push(thinkingTail(1), bash1);

    const lines = render(bash1);
    expect(lines[0]).not.toBe("");
    expect(lines[0].startsWith("  ┃")).toBe(true);
  });

  it("keeps ensuring the leading blank after an unmarked sibling", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(textBlock(["assistant text"]), read1, read2);

    expect(render(read1)).toEqual(["", "  ❙  ◈ Read 2 files"]);
  });
});
