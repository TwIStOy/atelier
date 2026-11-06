import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type * as Common from "@htwang-contrib/common";
import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.ts";
import { globalToolDisplayRegistry } from "../src/registry.ts";
import type { ToolDisplayAdapter } from "../src/types.ts";

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

const PLAIN_THEME: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
} as Theme;

const fakeAdapter: ToolDisplayAdapter = {
  formatCallHeader: () => "MouseTool",
  formatCollapsedContent: () => ["collapsed"],
  formatExpandedContent: () => ["expanded"],
};

type PatchedMouseEvent = {
  type: string;
  button: string;
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  width: number;
  height: number;
};

type PatchedComponent = {
  expanded: boolean;
  result?: unknown;
  handleMouse(event: PatchedMouseEvent): unknown;
  updateResult(result: unknown, isPartial?: boolean): void;
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

function makeComponent(toolName: string): PatchedComponent {
  const toolDefinition: ToolDefinition = {
    name: toolName,
    label: toolName,
    description: "test tool",
    parameters: Type.Object({}),
    execute: async () => ({ content: [], details: {} }),
    renderCall: () => new Text("header"),
    renderResult: () => new Text("result"),
    renderShell: "self",
  };
  const fakeUi = undefined as unknown as ConstructorParameters<typeof ToolExecutionComponent>[5];
  return new ToolExecutionComponent(
    toolName,
    "call-1",
    {},
    {},
    toolDefinition,
    fakeUi,
    process.cwd(),
  ) as unknown as PatchedComponent;
}

function withResult(component: PatchedComponent): PatchedComponent {
  component.updateResult({ content: [{ type: "text", text: "done" }], details: {} }, false);
  return component;
}

function mouseEvent(overrides: Partial<PatchedMouseEvent>): PatchedMouseEvent {
  return {
    type: "click",
    button: "left",
    x: 2,
    y: 1,
    screenX: 2,
    screenY: 5,
    width: 80,
    height: 3,
    ...overrides,
  };
}

describe("patched handleMouse", () => {
  it("toggles expanded on left click for adapter-rendered blocks", () => {
    activateExtension();
    globalToolDisplayRegistry.register("mousetool", fakeAdapter);
    const component = withResult(makeComponent("mousetool"));

    expect(component.handleMouse(mouseEvent({}))).toEqual({ handled: true });
    expect(component.expanded).toBe(true);
    expect(component.handleMouse(mouseEvent({}))).toEqual({ handled: true });
    expect(component.expanded).toBe(false);
  });

  it("ignores clicks before the result arrives", () => {
    activateExtension();
    globalToolDisplayRegistry.register("mousetool", fakeAdapter);
    const component = makeComponent("mousetool");

    expect(component.handleMouse(mouseEvent({}))).toBeUndefined();
    expect(component.expanded).toBe(false);
  });

  it("ignores non-click events and non-left buttons", () => {
    activateExtension();
    globalToolDisplayRegistry.register("mousetool", fakeAdapter);
    const component = withResult(makeComponent("mousetool"));

    expect(component.handleMouse(mouseEvent({ type: "wheel", button: "none" }))).toBeUndefined();
    expect(component.handleMouse(mouseEvent({ type: "press" }))).toBeUndefined();
    expect(component.handleMouse(mouseEvent({ button: "right" }))).toBeUndefined();
    expect(component.expanded).toBe(false);
  });

  it("leaves non-adapter tools to the stock dispatch", () => {
    activateExtension();
    const component = withResult(makeComponent("plain_tool"));

    expect(component.handleMouse(mouseEvent({}))).toBeUndefined();
    expect(component.expanded).toBe(false);
  });
});
