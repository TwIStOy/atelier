import { fileURLToPath } from "node:url";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type * as Common from "@htwang-contrib/common";
import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.ts";
import { globalToolDisplayRegistry } from "../src/registry.ts";
import type { ToolDisplayAdapter } from "../src/types.ts";

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

const fakeAdapter: ToolDisplayAdapter = {
  formatCallHeader: () => "SpacingTool",
  formatCollapsedContent: () => ["collapsed"],
  formatExpandedContent: () => ["expanded"],
};

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

function makeComponent(
  toolName: string,
  root: FakeRoot,
  options: { withNativeRenderer?: boolean } = {},
): ToolExecutionComponent {
  const toolDefinition: ToolDefinition = {
    name: toolName,
    label: toolName,
    description: "test tool",
    parameters: Type.Object({}),
    execute: async () => ({ content: [], details: {} }),
    ...(options.withNativeRenderer
      ? {
          renderCall: () => new Text("native header", 1, 0),
          renderResult: () => new Text("native result", 1, 0),
          renderShell: "self" as const,
        }
      : {}),
  };
  return new ToolExecutionComponent(
    toolName,
    `call-${toolName}`,
    {},
    {},
    toolDefinition,
    root as unknown as ConstructorParameters<typeof ToolExecutionComponent>[5],
    process.cwd(),
  );
}

function withResult(component: ToolExecutionComponent): ToolExecutionComponent {
  component.updateResult({ content: [{ type: "text", text: "done" }], details: {} }, false);
  return component;
}

const invisibleSibling = { render: () => [] as string[] };

describe("tool group spacing", () => {
  it("keeps a leading blank line when the previous sibling is not a tool", () => {
    activateExtension();
    globalToolDisplayRegistry.register("spacingtool", fakeAdapter);
    const root: FakeRoot = { children: [] };
    const textBlock = { render: () => ["hello"] };
    const tool = withResult(makeComponent("spacingtool", root));
    root.children.push(textBlock, tool);

    const lines = tool.render(80);
    expect(lines[0].trim()).toBe("");
  });

  it("drops the leading blank line when preceded by another tool widget (adapter path)", () => {
    activateExtension();
    globalToolDisplayRegistry.register("spacingtool", fakeAdapter);
    const root: FakeRoot = { children: [] };
    const first = withResult(makeComponent("spacingtool", root));
    const second = withResult(makeComponent("spacingtool", root));
    root.children.push(first, second);

    const lines = second.render(80);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0].trim()).not.toBe("");
  });

  it("drops the stock spacer on the native-renderer fallback path when preceded by a tool", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const first = withResult(makeComponent("nativetool", root, { withNativeRenderer: true }));
    const second = withResult(makeComponent("nativetool", root, { withNativeRenderer: true }));
    root.children.push(first, second);

    const firstLines = first.render(80);
    expect(firstLines[0].trim()).toBe("");
    const secondLines = second.render(80);
    expect(secondLines.length).toBeGreaterThan(0);
    expect(secondLines[0].trim()).not.toBe("");
  });

  it("skips zero-line siblings when resolving the previous visible sibling", () => {
    activateExtension();
    globalToolDisplayRegistry.register("spacingtool", fakeAdapter);
    const root: FakeRoot = { children: [] };
    const first = withResult(makeComponent("spacingtool", root));
    const second = withResult(makeComponent("spacingtool", root));
    root.children.push(first, invisibleSibling, second);

    const lines = second.render(80);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0].trim()).not.toBe("");
  });
});
