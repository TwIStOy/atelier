import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled } from "@htwang-contrib/common/extension-disable";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerRexTitleConfigItems } from "../src/config.ts";
import rexTitleExtension from "../src/index.ts";
import { createTitleUpdater, type TitleUpdater } from "../src/title-updater.ts";

vi.mock("@htwang-contrib/common/extension-disable", () => ({ isExtensionDisabled: vi.fn() }));
vi.mock("../src/config.ts", () => ({
  registerRexTitleConfigItems: vi.fn(),
}));
vi.mock("../src/title-updater.ts", () => ({ createTitleUpdater: vi.fn() }));

type Handler = (...args: unknown[]) => unknown;

interface MockPi {
  handlers: Map<string, Handler[]>;
  commands: Map<string, { handler: Handler }>;
  exec: ExtensionAPI["exec"];
  on: (event: string, handler: Handler) => void;
  registerCommand: (name: string, options: { handler: Handler }) => void;
}

function mockPi(): MockPi {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, { handler: Handler }>();
  return {
    handlers,
    commands,
    exec: vi.fn(),
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerCommand(name, options) {
      commands.set(name, options);
    },
  };
}

function mockCtx(mode = "tui"): ExtensionCommandContext {
  return {
    mode,
    modelRegistry: {
      getAvailable: () => [{ provider: "magpie", id: "fast", name: "Fast" }],
    },
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    ui: { notify: vi.fn() },
  } as unknown as ExtensionCommandContext;
}

async function emit(pi: MockPi, event: string, payload: unknown, ctx: ExtensionContext): Promise<void> {
  for (const handler of pi.handlers.get(event) ?? []) await handler(payload, ctx);
}

async function start(pi: MockPi, ctx = mockCtx()): Promise<ExtensionCommandContext> {
  rexTitleExtension(pi as unknown as ExtensionAPI);
  await emit(pi, "session_start", { reason: "startup" }, ctx);
  return ctx;
}

async function runCommand(pi: MockPi, ctx: ExtensionCommandContext): Promise<void> {
  const command = pi.commands.get("rex-title");
  if (!command) throw new Error("rex-title command was not registered");
  await command.handler("", ctx);
}

function updaterMock(): TitleUpdater {
  return {
    refresh: vi.fn(),
    run: vi.fn().mockResolvedValue({ ok: true, title: "Generated title" }),
    cancel: vi.fn(),
  };
}

let updater: TitleUpdater;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isExtensionDisabled).mockReturnValue(false);
  updater = updaterMock();
  vi.mocked(createTitleUpdater).mockReturnValue(updater);
});

describe("extension lifecycle", () => {
  it("binds the model setting to the live session registry", async () => {
    const pi = mockPi();
    const ctx = await start(pi);
    expect(registerRexTitleConfigItems).toHaveBeenCalledWith(ctx.modelRegistry);
  });

  it("refreshes after every user-message agent run in the TUI", async () => {
    const pi = mockPi();
    const ctx = await start(pi);
    await emit(pi, "before_agent_start", { messageType: "user" }, ctx);
    await emit(pi, "agent_end", { messages: [] }, ctx);
    expect(updater.refresh).toHaveBeenCalledWith(ctx);
  });

  it("also detects user messages from the agent_end payload", async () => {
    const pi = mockPi();
    const ctx = await start(pi);
    await emit(pi, "agent_end", { messages: [{ role: "user", content: "hello", timestamp: 1 }] }, ctx);
    expect(updater.refresh).toHaveBeenCalledOnce();
  });

  it("does not refresh for assistant-only runs, custom continuations, or non-TUI sessions", async () => {
    const pi = mockPi();
    const ctx = await start(pi);
    await emit(pi, "agent_end", { messages: [{ role: "assistant", content: [] }] }, ctx);
    await emit(pi, "before_agent_start", { messageType: "custom" }, ctx);
    await emit(pi, "agent_end", { messages: [] }, ctx);
    await emit(pi, "agent_end", { messages: [{ role: "user", content: "hello", timestamp: 1 }] }, mockCtx("rpc"));
    expect(updater.refresh).not.toHaveBeenCalled();
  });

  it("cancels pending work on session changes and shutdown", async () => {
    const pi = mockPi();
    const ctx = await start(pi);
    await emit(pi, "session_start", { reason: "resume" }, ctx);
    await emit(pi, "session_shutdown", { reason: "quit" }, ctx);
    expect(updater.cancel).toHaveBeenCalledTimes(3);
  });
});

describe("/rex-title", () => {
  it("registers only for the interactive TUI", async () => {
    const tui = mockPi();
    await start(tui);
    expect(tui.commands.has("rex-title")).toBe(true);

    const rpc = mockPi();
    await start(rpc, mockCtx("rpc"));
    expect(rpc.commands.has("rex-title")).toBe(false);
  });

  it("waits for idle and reports a successful forced refresh", async () => {
    const pi = mockPi();
    const ctx = await start(pi);
    await runCommand(pi, ctx);
    expect(ctx.waitForIdle).toHaveBeenCalledOnce();
    expect(updater.run).toHaveBeenCalledWith(ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith('Session title set to "Generated title".', "info");
  });

  it("reports model and timeout failures but stays quiet for superseded runs", async () => {
    const pi = mockPi();
    const ctx = await start(pi);
    vi.mocked(updater.run)
      .mockResolvedValueOnce({ ok: false, error: "model unavailable" })
      .mockResolvedValueOnce({ ok: false, error: "timed out", timedOut: true })
      .mockResolvedValueOnce({ ok: false, error: "cancelled", cancelled: true });

    await runCommand(pi, ctx);
    await runCommand(pi, ctx);
    await runCommand(pi, ctx);

    expect(ctx.ui.notify).toHaveBeenNthCalledWith(1, "Could not update Rex title: model unavailable", "error");
    expect(ctx.ui.notify).toHaveBeenNthCalledWith(2, "timed out", "warning");
    expect(ctx.ui.notify).toHaveBeenCalledTimes(2);
  });
});
