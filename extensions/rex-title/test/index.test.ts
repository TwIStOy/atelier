import type { Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled } from "@htwang-contrib/common/extension-disable";
import { getLocalRexContext, type RexContext, renameRexPane } from "@htwang-contrib/common/rex";
import { executeSideCall } from "@htwang-contrib/common/side-call";
import { beforeEach, describe, expect, it, vi } from "vitest";
import rexTitleExtension, { buildTitlePrompt, parseTitle } from "../src/index.ts";

vi.mock("@htwang-contrib/common/extension-disable", () => ({ isExtensionDisabled: vi.fn() }));
vi.mock("@htwang-contrib/common/rex", () => ({
  getLocalRexContext: vi.fn(),
  renameRexPane: vi.fn(),
}));
vi.mock("@htwang-contrib/common/side-call", () => ({ executeSideCall: vi.fn() }));

type Handler = (...args: unknown[]) => unknown;

interface MockPi {
  handlers: Map<string, Handler[]>;
  commands: Map<string, { handler: Handler }>;
  exec: ExtensionAPI["exec"];
  on: (event: string, handler: Handler) => void;
  registerCommand: (name: string, options: { handler: Handler }) => void;
}

const rex: RexContext = {
  executable: "/bin/rex",
  endpoint: "unix:///run/rex/server.sock",
  sessionId: "session:test",
  blockId: "block:test",
};

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

async function start(pi: MockPi, mode = "tui"): Promise<void> {
  rexTitleExtension(pi as unknown as ExtensionAPI);
  for (const handler of pi.handlers.get("session_start") ?? []) {
    await handler({ reason: "startup" }, { mode });
  }
}

async function runCommand(pi: MockPi, ctx: ExtensionCommandContext): Promise<void> {
  const command = pi.commands.get("rex-title");
  if (!command) throw new Error("rex-title command was not registered");
  await command.handler("", ctx);
}

function userMessage(text: string): Message {
  return { role: "user", content: text, timestamp: 1_000 };
}

function mockCtx(options: { empty?: boolean; noModel?: boolean } = {}): ExtensionCommandContext {
  const messages = options.empty ? [] : [userMessage("Build an extension that names the current Rex pane")];
  const branch = messages.map((message, index) => ({
    type: "message",
    id: `message:${index}`,
    parentId: index === 0 ? null : `message:${index - 1}`,
    timestamp: "2026-01-01T00:00:00.000Z",
    message,
  }));
  return {
    model: options.noModel ? undefined : { provider: "test", id: "model" },
    modelRegistry: {},
    sessionManager: { getBranch: () => branch },
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    ui: { notify: vi.fn() },
  } as unknown as ExtensionCommandContext;
}

function respond(answer: string): void {
  vi.mocked(executeSideCall).mockResolvedValue({
    ok: true,
    answer,
    stopReason: "stop",
    assistantMessage: {
      role: "assistant",
      content: [{ type: "text", text: answer }],
      api: "openai-completions",
      provider: "test",
      model: "model",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 0,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isExtensionDisabled).mockReturnValue(false);
  vi.mocked(getLocalRexContext).mockResolvedValue(rex);
  vi.mocked(renameRexPane).mockResolvedValue(undefined);
  vi.mocked(executeSideCall).mockReset();
});

describe("title formatting", () => {
  it("collapses whitespace and control characters and removes wrapping punctuation", () => {
    expect(parseTitle('  "Fix\nRex\tlabels."  ')).toBe("Fix Rex labels");
    expect(parseTitle("Build\u0000 Rex title")).toBe("Build Rex title");
  });

  it("truncates by Unicode code point within the display budget", () => {
    const title = parseTitle("🦀".repeat(80));
    expect(Array.from(title)).toHaveLength(60);
    expect(title).toBe(`${"🦀".repeat(59)}…`);
  });

  it("returns an empty title for blank model output", () => {
    expect(parseTitle(" \n\t ")).toBe("");
  });
});

describe("buildTitlePrompt", () => {
  it("includes the transcript and retains the latest text within the budget", () => {
    const prompt = buildTitlePrompt([userMessage("H".repeat(13_000)), userMessage("latest task")]);
    const conversation = prompt.split("<conversation>\n")[1]?.split("\n</conversation>")[0] ?? "";
    expect(conversation).toHaveLength(12_000);
    expect(conversation.endsWith("latest task")).toBe(true);
  });
});

describe("/rex-title", () => {
  it("registers only for the interactive TUI", async () => {
    const tui = mockPi();
    await start(tui);
    expect(tui.commands.has("rex-title")).toBe(true);

    const rpc = mockPi();
    await start(rpc, "rpc");
    expect(rpc.commands.has("rex-title")).toBe(false);
  });

  it("summarizes the current branch and renames the originating pane", async () => {
    const pi = mockPi();
    const ctx = mockCtx();
    await start(pi);
    respond("Build Rex title extension");

    await runCommand(pi, ctx);

    expect(ctx.waitForIdle).toHaveBeenCalledOnce();
    expect(executeSideCall).toHaveBeenCalledWith(
      expect.objectContaining({
        model: ctx.model,
        modelRegistry: ctx.modelRegistry,
        commandName: "rex-title",
      }),
    );
    const call = vi.mocked(executeSideCall).mock.calls[0]?.[0];
    expect(call?.messages[0]?.content).toContain("Build an extension that names the current Rex pane");
    expect(renameRexPane).toHaveBeenCalledWith(pi.exec, rex, "Build Rex title extension");
    expect(ctx.ui.notify).toHaveBeenCalledWith('Rex pane renamed to "Build Rex title extension".', "info");
  });

  it("skips model and Rex calls for an empty session", async () => {
    const pi = mockPi();
    const ctx = mockCtx({ empty: true });
    await start(pi);

    await runCommand(pi, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Start a conversation before generating a Rex title.", "warning");
    expect(getLocalRexContext).not.toHaveBeenCalled();
    expect(executeSideCall).not.toHaveBeenCalled();
  });

  it("reports a missing active model without making a side-call", async () => {
    const pi = mockPi();
    const ctx = mockCtx({ noModel: true });
    await start(pi);

    await runCommand(pi, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith("No active model is available for Rex title generation.", "warning");
    expect(executeSideCall).not.toHaveBeenCalled();
    expect(renameRexPane).not.toHaveBeenCalled();
  });

  it("times out the model side-call without renaming the pane", async () => {
    const timeoutController = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutController.signal);
    try {
      const pi = mockPi();
      const ctx = mockCtx();
      await start(pi);
      vi.mocked(executeSideCall).mockImplementation(({ signal }) => {
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve({ ok: false, aborted: true, stopReason: "aborted" }), {
            once: true,
          });
        });
      });

      const run = runCommand(pi, ctx);
      await vi.waitFor(() => expect(executeSideCall).toHaveBeenCalled());
      timeoutController.abort();
      await run;

      expect(timeout).toHaveBeenCalledWith(60_000);
      expect(renameRexPane).not.toHaveBeenCalled();
      expect(ctx.ui.notify).toHaveBeenCalledWith("Rex title generation timed out.", "warning");
    } finally {
      timeout.mockRestore();
    }
  });

  it("reports model failures without renaming the pane", async () => {
    const pi = mockPi();
    const ctx = mockCtx();
    await start(pi);
    vi.mocked(executeSideCall).mockResolvedValue({ ok: false, error: "model unavailable" });

    await runCommand(pi, ctx);

    expect(renameRexPane).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Could not update Rex title: model unavailable", "error");
  });
});
