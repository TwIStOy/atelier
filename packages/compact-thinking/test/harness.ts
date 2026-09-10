import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantMessageComponent, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";
import type { TuiMouseButton, TuiMouseEvent } from "@earendil-works/pi-tui";
import { vi } from "vitest";
import extension from "../src/index.ts";

export const PLAIN_THEME: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
} as Theme;

export const DIM_THEME: Theme = {
  fg: (color: string, text: string) =>
    `\x1b[${color === "dim" ? "90" : color === "error" ? "31" : "39"}m${text}\x1b[39m`,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
} as Theme;

export type SessionEventHandler = (event: unknown, ctx: unknown) => void;

export interface TestSession {
  handlers: Map<string, SessionEventHandler[]>;
  emit(name: string, event: unknown): void;
  appendEntry: ReturnType<typeof vi.fn>;
  shutdown(): void;
}

export interface ActivateOptions {
  theme?: Theme;
  entries?: unknown[];
  ctx?: Record<string, unknown>;
  tuiRoot?: { children: unknown[] };
}

export function activateExtension(options: ActivateOptions = {}): TestSession {
  const handlers = new Map<string, SessionEventHandler[]>();
  const appendEntry = vi.fn();
  const pi = {
    events: { on: vi.fn(), emit: vi.fn() },
    on: vi.fn((name: string, handler: SessionEventHandler) => {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    }),
    appendEntry,
  };
  extension(pi as unknown as ExtensionAPI);
  const sessionStart = handlers.get("session_start")?.[0];
  if (!sessionStart) throw new Error("session_start handler not registered");
  const setWidget = vi.fn((_key: string, content: unknown) => {
    if (options.tuiRoot && typeof content === "function") {
      Object.assign(options.tuiRoot, { invalidate: vi.fn(), requestRender: vi.fn() });
      (content as (tui: unknown, theme: Theme) => unknown)(options.tuiRoot, options.theme ?? PLAIN_THEME);
    }
  });
  sessionStart(undefined, {
    mode: "tui",
    ui: { theme: options.theme ?? PLAIN_THEME, setWidget },
    modelRegistry: { getAvailable: () => [] },
    sessionManager: { getBranch: () => options.entries ?? [] },
    ...options.ctx,
  });
  return {
    handlers,
    emit(name, event) {
      for (const handler of handlers.get(name) ?? []) handler(event, undefined);
    },
    appendEntry,
    shutdown() {
      for (const handler of handlers.get("session_shutdown") ?? [])
        handler(undefined, { mode: "tui", ui: { setWidget: vi.fn() } });
    },
  };
}

export function makeMessage(content: AssistantMessage["content"], timestamp = 42): AssistantMessage {
  return { role: "assistant", timestamp, content, stopReason: "stop" } as unknown as AssistantMessage;
}

export type Clickable = {
  render(width: number): string[];
  handleMouse(event: TuiMouseEvent): unknown;
};

export function makeComponent(message: AssistantMessage): Clickable {
  const markdownTheme = {} as ConstructorParameters<typeof AssistantMessageComponent>[2];
  return new AssistantMessageComponent(message, true, markdownTheme, "Thinking...", 1, []) as unknown as Clickable;
}

export function click(component: Clickable, y: number, height: number, button: TuiMouseButton = "left"): unknown {
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

export function emitAssistantUpdate(
  session: TestSession,
  message: AssistantMessage,
  update: { type: string; contentIndex?: number },
): void {
  session.emit("message_update", { message, assistantMessageEvent: { contentIndex: 0, ...update } });
}
