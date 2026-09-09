import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
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

const PLAIN_THEME: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
} as Theme;

const fakeAdapter: ToolDisplayAdapter = {
  formatCallHeader: () => "HoverTool",
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
  __tdHovered?: boolean;
  result?: unknown;
  render(width: number): string[];
  handleMouse(event: PatchedMouseEvent): unknown;
  updateResult(result: unknown, isPartial?: boolean): void;
  setExpanded(expanded: boolean): void;
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
    type: "move",
    button: "none",
    x: 2,
    y: 1,
    screenX: 2,
    screenY: 5,
    width: 80,
    height: 3,
    ...overrides,
  };
}

function firstHeaderLine(component: PatchedComponent): string {
  return component.render(80).find((line) => line.includes("HoverTool")) ?? "";
}

function moveOffHoveredTool(): void {
  const container = new Container();
  container.addChild(new Text("plain text", 1, 1));
  (container as unknown as { handleMouse(event: PatchedMouseEvent): unknown }).handleMouse(
    mouseEvent({ y: 0, height: 1 }),
  );
}

describe("hover affordance", () => {
  it("claims hover on first move and renders without repeat renders", () => {
    activateExtension();
    globalToolDisplayRegistry.register("hovertool", fakeAdapter);
    const component = withResult(makeComponent("hovertool"));

    expect(component.handleMouse(mouseEvent({}))).toEqual({ handled: true, render: true });
    expect(component.__tdHovered).toBe(true);
    expect(component.handleMouse(mouseEvent({}))).toEqual({ handled: true });

    moveOffHoveredTool();
  });

  it("swaps the status diamond for an angle quote while hovered and collapsed", () => {
    activateExtension();
    globalToolDisplayRegistry.register("hovertool", fakeAdapter);
    const component = withResult(makeComponent("hovertool"));

    expect(firstHeaderLine(component)[5]).toBe("◆");

    component.handleMouse(mouseEvent({}));
    expect(firstHeaderLine(component)[5]).toBe("›");

    component.handleMouse(mouseEvent({ type: "click", button: "left" }));
    expect(component.expanded).toBe(true);
    expect(firstHeaderLine(component)[5]).toBe("◆");

    component.setExpanded(false);
    expect(firstHeaderLine(component)[5]).toBe("›");

    moveOffHoveredTool();
  });

  it("ignores moves on expanded or result-less tools", () => {
    activateExtension();
    globalToolDisplayRegistry.register("hovertool", fakeAdapter);
    const expanded = withResult(makeComponent("hovertool"));
    expanded.setExpanded(true);
    expect(expanded.handleMouse(mouseEvent({}))).toBeUndefined();

    const pending = makeComponent("hovertool");
    expect(pending.handleMouse(mouseEvent({}))).toBeUndefined();
  });

  it("clears hover when the cursor moves to another tool widget", () => {
    activateExtension();
    globalToolDisplayRegistry.register("hovertool", fakeAdapter);
    const first = withResult(makeComponent("hovertool"));
    const second = withResult(makeComponent("hovertool"));

    first.handleMouse(mouseEvent({}));
    expect(first.__tdHovered).toBe(true);

    second.handleMouse(mouseEvent({ screenY: 9 }));
    expect(first.__tdHovered).toBe(false);
    expect(second.__tdHovered).toBe(true);

    moveOffHoveredTool();
    expect(second.__tdHovered).toBe(false);
  });

  it("clears hover when a plain container handles an unhandled move", () => {
    activateExtension();
    globalToolDisplayRegistry.register("hovertool", fakeAdapter);
    const component = withResult(makeComponent("hovertool"));
    component.handleMouse(mouseEvent({}));
    expect(component.__tdHovered).toBe(true);

    const container = new Container();
    container.addChild(new Text("plain text", 1, 1));
    expect(
      (container as unknown as { handleMouse(event: PatchedMouseEvent): unknown }).handleMouse(
        mouseEvent({ y: 0, height: 1 }),
      ),
    ).toEqual({
      handled: true,
      render: true,
    });
    expect(component.__tdHovered).toBe(false);
    expect(firstHeaderLine(component)[5]).toBe("◆");
  });
});
