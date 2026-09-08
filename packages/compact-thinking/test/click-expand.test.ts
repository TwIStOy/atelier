import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantMessageComponent, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";
import type { TuiMouseButton, TuiMouseEvent } from "@earendil-works/pi-tui";
import type * as Common from "@htwang-contrib/common";
import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.ts";

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

const PLAIN_THEME: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
} as Theme;

type Clickable = {
  render(width: number): string[];
  handleMouse(event: TuiMouseEvent): unknown;
};

function activateExtension() {
  const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => void>>();
  const pi = {
    events: { on: vi.fn(), emit: vi.fn() },
    on: vi.fn((name: string, handler: (event: unknown, ctx: unknown) => void) => {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    }),
    appendEntry: vi.fn(),
  };
  extension(pi as unknown as ExtensionAPI);
  const sessionStart = handlers.get("session_start")?.[0];
  if (!sessionStart) throw new Error("session_start handler not registered");
  sessionStart(undefined, {
    mode: "tui",
    ui: { theme: PLAIN_THEME, setWidget: vi.fn() },
    modelRegistry: { getAvailable: () => [] },
    sessionManager: { getBranch: () => [] },
  });
}

function makeMessage(): AssistantMessage {
  return {
    role: "assistant",
    timestamp: 42,
    content: [{ type: "thinking", thinking: "l1\nl2\nl3\nl4\nl5\nl6" }],
    stopReason: "stop",
  } as unknown as AssistantMessage;
}

function makeComponent(): Clickable {
  const markdownTheme = {} as ConstructorParameters<typeof AssistantMessageComponent>[2];
  return new AssistantMessageComponent(
    makeMessage(),
    true,
    markdownTheme,
    "Thinking...",
    1,
    [],
  ) as unknown as Clickable;
}

function click(component: Clickable, y: number, height: number, button: TuiMouseButton = "left"): unknown {
  return component.handleMouse({
    type: "click",
    button,
    x: 4,
    y,
    screenX: 4,
    screenY: y + 10,
    width: 80,
    height,
    shift: false,
    alt: false,
    ctrl: false,
  });
}

describe("compact thinking click expansion", () => {
  it("expands and collapses a single thinking run on left click", () => {
    activateExtension();
    const component = makeComponent();

    const collapsed = component.render(80).join("\n");
    expect(collapsed).toContain("Thinking...");
    expect(collapsed).toContain("3 more lines");
    expect(collapsed).toContain("click");
    expect(collapsed).not.toContain("l1\n");

    const height = component.render(80).length;
    expect(click(component, 1, height)).toMatchObject({ handled: true });

    const expanded = component.render(80).join("\n");
    expect(expanded).toContain("l1");
    expect(expanded).toContain("l6");
    expect(expanded).toContain("click to collapse");

    expect(click(component, 1, component.render(80).length)).toMatchObject({ handled: true });
    const collapsedAgain = component.render(80).join("\n");
    expect(collapsedAgain).toContain("3 more lines");
    expect(collapsedAgain).not.toContain("l1\n");
  });

  it("ignores non-left-button and non-click events", () => {
    activateExtension();
    const component = makeComponent();
    const height = component.render(80).length;

    expect(click(component, 1, height, "right")).toBeUndefined();
    expect(
      component.handleMouse({
        type: "wheel",
        button: "none",
        x: 4,
        y: 1,
        screenX: 4,
        screenY: 11,
        width: 80,
        height,
        shift: false,
        alt: false,
        ctrl: false,
        wheelDelta: -3,
      }),
    ).toBeUndefined();
    expect(component.render(80).join("\n")).toContain("3 more lines");
  });

  it("expands only the clicked run", () => {
    activateExtension();
    const message = {
      role: "assistant",
      timestamp: 43,
      content: [
        { type: "thinking", thinking: "a1\na2\na3\na4" },
        { type: "text", text: "middle" },
        { type: "thinking", thinking: "b1\nb2\nb3\nb4" },
      ],
      stopReason: "stop",
    } as unknown as AssistantMessage;
    const markdownTheme = {} as ConstructorParameters<typeof AssistantMessageComponent>[2];
    const component = new AssistantMessageComponent(
      message,
      true,
      markdownTheme,
      "Thinking...",
      1,
      [],
    ) as unknown as Clickable;

    const collapsed = component.render(80).join("\n");
    expect(collapsed).toContain("a4");
    expect(collapsed).toContain("b4");
    expect(collapsed).not.toContain("a1\n");

    const height = component.render(80).length;
    expect(click(component, 1, height)).toMatchObject({ handled: true });

    const after = component.render(80).join("\n");
    expect(after).toContain("a1");
    expect(after).not.toContain("b1\n");
  });
});
