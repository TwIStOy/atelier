import { clearGlobalState } from "@htwang-contrib/common";
import { describe, expect, test, vi } from "vitest";
import { clearSessionHistory, registerBtw } from "../src/btw.ts";
import type { BtwTurn } from "../src/btw-ui.ts";

const BTW_STATE_KEY = "htwang-contrib-btw";

function mockCtx(opts: { sessionFile?: string | null; sessionId?: string; hasUI?: boolean; model?: unknown } = {}) {
  return {
    hasUI: opts.hasUI ?? true,
    sessionManager: {
      getSessionFile: () => opts.sessionFile ?? "/tmp/test-session.jsonl",
      getSessionId: () => opts.sessionId ?? "test-id",
      getBranch: () => [],
    },
    model: "model" in opts ? opts.model : { provider: "test", id: "m1" },
    modelRegistry: {},
    ui: {
      notify: vi.fn(),
      custom: vi.fn(),
    },
  } as unknown as import("@earendil-works/pi-coding-agent").ExtensionCommandContext;
}

interface MockPi {
  onHandlers: Record<string, Handler>;
  commands: Record<string, { handler: Handler; description?: string }>;
  on: (event: string, handler: Handler) => void;
  registerCommand: (name: string, options: { handler: Handler; description?: string }) => void;
}

type Handler = (...args: unknown[]) => unknown;

function mockPi(): MockPi {
  const onHandlers: Record<string, Handler> = {};
  const commands: Record<string, { handler: Handler; description?: string }> = {};
  return {
    onHandlers,
    commands,
    on(event: string, handler: Handler) {
      onHandlers[event] = handler;
    },
    registerCommand(name: string, options: { handler: Handler; description?: string }) {
      commands[name] = options;
    },
  } as unknown as MockPi;
}

async function startInMode(pi: MockPi, mode: string): Promise<void> {
  await pi.onHandlers.session_start?.({ type: "session_start", reason: "startup" }, { mode });
}

function makeTurn(question: string, answer: string): BtwTurn {
  return {
    userMessage: {
      role: "user",
      content: question,
      timestamp: Date.now(),
    } as import("@earendil-works/pi-ai").UserMessage,
    assistantMessage: {
      role: "assistant",
      content: [{ type: "text", text: answer }],
    } as unknown as import("@earendil-works/pi-ai").AssistantMessage,
  };
}

describe("registerBtw", () => {
  test("registers the /btw command after session_start in tui mode", async () => {
    clearGlobalState(BTW_STATE_KEY);
    const pi = mockPi();
    registerBtw(pi as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI);
    expect(pi.commands.btw).toBeUndefined();
    await startInMode(pi, "tui");
    expect(pi.commands.btw).toBeDefined();
    expect(pi.commands.btw.handler).toBeInstanceOf(Function);
  });

  test("does not register the /btw command in rpc mode", async () => {
    clearGlobalState(BTW_STATE_KEY);
    const pi = mockPi();
    registerBtw(pi as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI);
    await startInMode(pi, "rpc");
    expect(pi.commands.btw).toBeUndefined();
  });

  test("registers message_end hook", () => {
    clearGlobalState(BTW_STATE_KEY);
    const pi = mockPi();
    registerBtw(pi as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI);
    expect(pi.onHandlers.message_end).toBeDefined();
  });

  test("registers session_compact and session_tree hooks", () => {
    clearGlobalState(BTW_STATE_KEY);
    const pi = mockPi();
    registerBtw(pi as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI);
    expect(pi.onHandlers.session_compact).toBeDefined();
    expect(pi.onHandlers.session_tree).toBeDefined();
  });
});

describe("command handler guards", () => {
  async function startedPi(): Promise<MockPi> {
    clearGlobalState(BTW_STATE_KEY);
    const pi = mockPi();
    registerBtw(pi as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI);
    await startInMode(pi, "tui");
    return pi;
  }

  test("notifies when hasUI is false", async () => {
    const pi = await startedPi();
    const ctx = mockCtx({ hasUI: false });
    await pi.commands.btw.handler("what?", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("interactive terminal"), "warning");
  });

  test("notifies when args are empty", async () => {
    const pi = await startedPi();
    const ctx = mockCtx();
    await pi.commands.btw.handler("  ", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("requires a question"), "warning");
  });

  test("notifies when no model is set", async () => {
    const pi = await startedPi();
    const ctx = mockCtx({ model: undefined });
    await pi.commands.btw.handler("what?", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("active model"), "warning");
  });
});

describe("clearSessionHistory", () => {
  test("resets the session history array", () => {
    clearGlobalState(BTW_STATE_KEY);
    const state = { histories: new Map<string, BtwTurn[]>() };
    const ctx = mockCtx({ sessionFile: "/tmp/sess.jsonl" });

    state.histories.set("/tmp/sess.jsonl", [makeTurn("q", "a")]);
    clearSessionHistory(state, ctx);

    const history = state.histories.get("/tmp/sess.jsonl");
    expect(history).toEqual([]);
  });
});
