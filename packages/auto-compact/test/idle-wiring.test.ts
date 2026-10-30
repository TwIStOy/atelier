import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type * as Common from "@htwang-contrib/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import autoCompact from "../src/index.ts";
import { compactionEntry, messageEntry } from "./helpers.ts";

const mockConfig = vi.hoisted(() => ({
  current: {
    autoCompactPercent: 90,
    autoCompactTokenLimit: 0,
    keepRecentPercent: 15,
    strategy: "keep-recent",
    idleCompactMinutes: 30,
  } as Record<string, unknown>,
}));

vi.mock("@htwang-contrib/common", async (importOriginal) => ({
  ...(await importOriginal<typeof Common>()),
  isExtensionDisabled: () => false,
  readConfig: () => mockConfig.current,
  registerConfigItems: vi.fn(),
}));

type Handler = (...args: unknown[]) => unknown;

interface MockPi {
  handlers: Map<string, Handler>;
  commands: Map<string, { description?: string; handler: Handler }>;
  sendUserMessage: ReturnType<typeof vi.fn>;
  pi: ExtensionAPI;
}

function createMockPi(): MockPi {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, { description?: string; handler: Handler }>();
  const sendUserMessage = vi.fn();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
    registerCommand(name: string, options: { description?: string; handler: Handler }) {
      commands.set(name, options);
    },
    sendUserMessage,
  };
  return { handlers, commands, sendUserMessage, pi: pi as unknown as ExtensionAPI };
}

interface CompactCall {
  customInstructions?: string;
  onComplete?: (result: unknown) => void;
  onError?: (error: Error) => void;
}

interface MockCtx {
  ctx: ExtensionContext;
  compact: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
  branch: SessionEntry[];
}

function createMockCtx(tokens: number | null, contextWindow = 200_000): MockCtx {
  const compact = vi.fn();
  const notify = vi.fn();
  const branch: SessionEntry[] = [];
  const usage = tokens === null ? undefined : { tokens, contextWindow, percent: (tokens / contextWindow) * 100 };
  const ctx = {
    getContextUsage: () => usage,
    compact,
    isIdle: () => true,
    model: { contextWindow },
    sessionManager: { getBranch: () => branch },
    ui: { notify },
  };
  return { ctx: ctx as unknown as ExtensionContext, compact, notify, branch };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function fireTurnStart(mock: MockPi, mockCtx: MockCtx, timestamp = Date.now()): void {
  mock.handlers.get("turn_start")!({ type: "turn_start", turnIndex: 0, timestamp }, mockCtx.ctx);
}

beforeEach(() => {
  mockConfig.current = {
    autoCompactPercent: 90,
    autoCompactTokenLimit: 0,
    keepRecentPercent: 15,
    strategy: "keep-recent",
    idleCompactMinutes: 30,
  };
});

describe("idle compaction wiring", () => {
  it("updates compaction thresholds when Pi reports a different context window", () => {
    const mock = createMockPi();
    autoCompact(mock.pi);
    const mockCtx = createMockCtx(190_000, 400_000);
    fireTurnStart(mock, mockCtx);
    expect(mockCtx.compact).not.toHaveBeenCalled();
    mockCtx.ctx.getContextUsage = () => ({ tokens: 190_000, contextWindow: 200_000, percent: 95 });
    fireTurnStart(mock, mockCtx);
    expect(mockCtx.compact).toHaveBeenCalledOnce();
  });

  it("does not compact against an unknown zero-sized context window", async () => {
    const mock = createMockPi();
    autoCompact(mock.pi);
    const mockCtx = createMockCtx(null, 0);
    fireTurnStart(mock, mockCtx);
    const messages = [messageEntry("user", 1).message, messageEntry("assistant", 2).message];
    const result = await mock.handlers.get("context")!({ messages }, mockCtx.ctx);
    await flush();
    expect(result).toBeUndefined();
    expect(mockCtx.compact).not.toHaveBeenCalled();
  });
  it("turn_start triggers idle compaction after the idle threshold and sends a follow-up", async () => {
    const mock = createMockPi();
    autoCompact(mock.pi);
    const mockCtx = createMockCtx(150_000);
    const now = Date.now();
    mockCtx.branch.push(messageEntry("assistant", now - 60 * 60_000));

    fireTurnStart(mock, mockCtx, now);
    expect(mockCtx.compact).toHaveBeenCalledTimes(1);

    const call = mockCtx.compact.mock.calls[0][0] as CompactCall;
    call.onComplete?.({});
    await flush();
    expect(mock.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(mock.sendUserMessage.mock.calls[0][0]).toContain("idle");
  });

  it("does not idle-compact below the 50% context window floor", () => {
    const mock = createMockPi();
    autoCompact(mock.pi);
    const mockCtx = createMockCtx(50_000);
    mockCtx.branch.push(messageEntry("assistant", Date.now() - 60 * 60_000));

    fireTurnStart(mock, mockCtx);
    expect(mockCtx.compact).not.toHaveBeenCalled();
  });

  it("idle compaction is disabled at the default of 0 minutes", () => {
    mockConfig.current.idleCompactMinutes = 0;
    const mock = createMockPi();
    autoCompact(mock.pi);
    const mockCtx = createMockCtx(150_000);
    mockCtx.branch.push(messageEntry("assistant", Date.now() - 60 * 60_000));

    fireTurnStart(mock, mockCtx);
    expect(mockCtx.compact).not.toHaveBeenCalled();
  });

  it("compacts only once when both the token and idle thresholds are met", async () => {
    const mock = createMockPi();
    autoCompact(mock.pi);
    const mockCtx = createMockCtx(190_000);
    mockCtx.branch.push(messageEntry("assistant", Date.now() - 60 * 60_000));

    fireTurnStart(mock, mockCtx);
    expect(mockCtx.compact).toHaveBeenCalledTimes(1);

    const call = mockCtx.compact.mock.calls[0][0] as CompactCall;
    expect(call.customInstructions).toContain("preserving task context");
    call.onComplete?.({});
    await flush();
    expect(mock.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(mock.sendUserMessage.mock.calls[0][0]).not.toContain("idle");
  });

  it("does not re-trigger while a compaction is pending", () => {
    const mock = createMockPi();
    autoCompact(mock.pi);
    const mockCtx = createMockCtx(150_000);
    mockCtx.branch.push(messageEntry("assistant", Date.now() - 60 * 60_000));

    fireTurnStart(mock, mockCtx);
    fireTurnStart(mock, mockCtx);
    expect(mockCtx.compact).toHaveBeenCalledTimes(1);
  });

  it("does not re-trigger after an idle compaction completes (fresh compaction entry self-heals)", () => {
    const mock = createMockPi();
    autoCompact(mock.pi);
    const mockCtx = createMockCtx(150_000);
    const now = Date.now();
    mockCtx.branch.push(messageEntry("assistant", now - 60 * 60_000));

    fireTurnStart(mock, mockCtx, now);
    (mockCtx.compact.mock.calls[0][0] as CompactCall).onComplete?.({});

    const later = Date.now() + 2_000;
    mockCtx.branch.push(compactionEntry(later));
    fireTurnStart(mock, mockCtx, later);
    expect(mockCtx.compact).toHaveBeenCalledTimes(1);
  });

  it("session resume compacts after an idle gap but sends no follow-up", async () => {
    const mock = createMockPi();
    autoCompact(mock.pi);
    const mockCtx = createMockCtx(150_000);
    mockCtx.branch.push(messageEntry("assistant", Date.now() - 60 * 60_000));

    mock.handlers.get("session_start")!({ type: "session_start", reason: "resume" }, mockCtx.ctx);
    expect(mockCtx.compact).toHaveBeenCalledTimes(1);

    (mockCtx.compact.mock.calls[0][0] as CompactCall).onComplete?.({});
    await flush();
    expect(mock.sendUserMessage).not.toHaveBeenCalled();
  });

  it("session resume still compacts on the token threshold alone when idle is disabled", async () => {
    mockConfig.current.idleCompactMinutes = 0;
    const mock = createMockPi();
    autoCompact(mock.pi);
    const mockCtx = createMockCtx(190_000);
    mockCtx.branch.push(messageEntry("assistant", Date.now()));

    mock.handlers.get("session_start")!({ type: "session_start", reason: "resume" }, mockCtx.ctx);
    expect(mockCtx.compact).toHaveBeenCalledTimes(1);
    (mockCtx.compact.mock.calls[0][0] as CompactCall).onComplete?.({});
    await flush();
    expect(mock.sendUserMessage).toHaveBeenCalledTimes(1);
  });

  it("accepts a numeric string threshold from a hand-edited config file", () => {
    mockConfig.current.idleCompactMinutes = "45";
    const mock = createMockPi();
    autoCompact(mock.pi);
    const now = Date.now();
    const mockCtx = createMockCtx(150_000);
    mockCtx.branch.push(messageEntry("assistant", now - 60 * 60_000));

    fireTurnStart(mock, mockCtx, now);
    expect(mockCtx.compact).toHaveBeenCalledTimes(1);
  });

  it("status command reports the idle threshold and current idle gap", async () => {
    const mock = createMockPi();
    autoCompact(mock.pi);
    const mockCtx = createMockCtx(150_000);
    const now = Date.now();
    mockCtx.branch.push(messageEntry("assistant", now - 42 * 60_000));

    const status = mock.commands.get("auto-compact")!;
    await status.handler("", mockCtx.ctx as never);
    const text = mockCtx.notify.mock.calls[0][0];
    expect(text).toContain("Idle threshold: 30 min");
    expect(text).toContain("Idle gap: 42");
  });
});
