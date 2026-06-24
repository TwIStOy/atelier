import type { ExtensionAPI, ExtensionContext, ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

type Handler = (...args: unknown[]) => unknown;

export const identityTheme: Theme = {
  fg: (_c: string, t: string) => t,
  bg: (_c: string, t: string) => t,
  bold: (t: string) => t,
  italic: (t: string) => t,
  underline: (t: string) => t,
  inverse: (t: string) => t,
  strikethrough: (t: string) => t,
  getFgAnsi: (_c: string) => "",
  getBgAnsi: (_c: string) => "",
  getColorMode: () => "truecolor",
  getThinkingBorderColor: () => (_s: string) => "",
  getBashModeBorderColor: () => (_s: string) => "",
} as unknown as Theme;

export function createMockPi(): {
  tools: Map<string, Record<string, unknown>>;
  commands: Map<string, { description?: string; handler: Handler }>;
  events: Map<string, Handler>;
  pi: ExtensionAPI;
} {
  const tools = new Map<string, Record<string, unknown>>();
  const commands = new Map<string, { description?: string; handler: Handler }>();
  const events = new Map<string, Handler>();

  const pi = {
    registerTool(tool: Record<string, unknown>) {
      tools.set(tool.name as string, tool);
    },
    registerCommand(name: string, options: { description?: string; handler: Handler }) {
      commands.set(name, options);
    },
    on(event: string, handler: Handler) {
      events.set(event, handler);
    },
  } as unknown as ExtensionAPI;

  return { tools, commands, events, pi };
}

export function createMockUI(opts: { requestRender?: () => void } = {}): {
  setWidget: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
  requestRender: ReturnType<typeof vi.fn>;
  ui: ExtensionUIContext;
} {
  const setWidget = vi.fn();
  const notify = vi.fn();
  const requestRender = opts.requestRender ? vi.fn(opts.requestRender) : vi.fn();

  const ui = {
    setWidget,
    notify,
    requestRender,
    select: vi.fn(),
    confirm: vi.fn(),
    input: vi.fn(),
    onTerminalInput: vi.fn(() => () => {}),
    setStatus: vi.fn(),
    setWorkingMessage: vi.fn(),
    setWorkingVisible: vi.fn(),
    setWorkingIndicator: vi.fn(),
    setHiddenThinkingLabel: vi.fn(),
    setFooter: vi.fn(),
    setHeader: vi.fn(),
    setTitle: vi.fn(),
    custom: vi.fn(),
    pasteToEditor: vi.fn(),
    setEditorText: vi.fn(),
    getEditorText: vi.fn(() => ""),
    editor: vi.fn(),
    addAutocompleteProvider: vi.fn(),
    setEditorComponent: vi.fn(),
    getEditorComponent: vi.fn(() => undefined),
    theme: identityTheme,
    getAllThemes: vi.fn(() => []),
    getTheme: vi.fn(() => undefined),
    setTheme: vi.fn(() => ({ success: true })),
    getToolsExpanded: vi.fn(() => false),
    setToolsExpanded: vi.fn(),
  } as unknown as ExtensionUIContext;

  return { setWidget, notify, requestRender, ui };
}

export function createMockCtx(
  opts: { hasUI?: boolean; ui?: ExtensionUIContext; branch?: Iterable<unknown> } = {},
): ExtensionContext {
  const { ui } = createMockUI();
  const ctx: {
    hasUI: boolean;
    ui: ExtensionUIContext;
    sessionManager: { getBranch: () => Iterable<unknown> };
  } = {
    hasUI: opts.hasUI ?? true,
    ui: opts.ui ?? ui,
    sessionManager: {
      getBranch: () => opts.branch ?? [],
    },
  };
  return ctx as unknown as ExtensionContext;
}
