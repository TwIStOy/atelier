import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as codingAgent from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerChildExtensionFactory } from "../../src/agents/child-extensions.ts";
import { type ChildSessionSpec, withChildSession } from "../../src/agents/child-session.ts";
import { recordChildSessionFinished, recordChildSessionStarted } from "../../src/agents/session-links.ts";

const h = vi.hoisted(() => ({
  log: [] as string[],
  loaderOptions: [] as Record<string, unknown>[],
  createSessionOptions: [] as Record<string, unknown>[],
  session: undefined as unknown,
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof codingAgent>();
  return {
    ...actual,
    SettingsManager: {
      create: vi.fn(() => {
        h.log.push("settings.create");
        return "settings";
      }),
    },
    SessionManager: {
      create: vi.fn((_cwd: string, _dir: string, _opts: unknown) => {
        h.log.push("session-manager.create");
        return { getSessionFile: () => "/tmp/child-sessions/child.jsonl" };
      }),
    },
    DefaultResourceLoader: vi.fn(function (this: { reload: () => Promise<void> }, options: Record<string, unknown>) {
      h.loaderOptions.push(options);
      this.reload = async () => {
        h.log.push("loader.reload");
      };
    }),
    ModelRuntime: {
      create: vi.fn(async () => {
        h.log.push("model-runtime.create");
      }),
    },
    createAgentSession: vi.fn(async (options: Record<string, unknown>) => {
      h.createSessionOptions.push(options);
      h.log.push("create-agent-session");
      return { session: h.session };
    }),
  };
});

vi.mock("../../src/agents/session-links.ts", () => ({
  recordChildSessionStarted: vi.fn(() => {
    h.log.push("record-started");
  }),
  recordChildSessionFinished: vi.fn(() => {
    h.log.push("record-finished");
  }),
}));

type FakeEvent = { type: string };

type FakeSession = {
  messages: unknown[];
  subscribe(listener: (event: FakeEvent) => void): () => void;
  emit(event: FakeEvent): void;
  prompt: (text: string) => Promise<void>;
  steer: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  bindExtensions: ReturnType<typeof vi.fn>;
  getSessionStats(): unknown;
  getContextUsage(): unknown;
  sessionManager: { getSessionFile(): string | undefined };
  extensionRunner: { hasHandlers(type: string): boolean };
  dispose: ReturnType<typeof vi.fn>;
};

function makeFakeSession(): FakeSession {
  const listeners = new Set<(event: FakeEvent) => void>();
  return {
    messages: [],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
    prompt: vi.fn(async () => {
      h.log.push("prompt");
    }),
    steer: vi.fn(async () => {}),
    abort: vi.fn(async () => {
      h.log.push("abort");
    }),
    bindExtensions: vi.fn(async () => {
      h.log.push("bind-extensions");
    }),
    getSessionStats: () => ({
      tokens: { input: 11, output: 7, cacheRead: 3, cacheWrite: 5, totalTokens: 26 },
      cost: 0.25,
    }),
    getContextUsage: () => ({ percent: 42, tokens: 8400, contextWindow: 20000 }),
    sessionManager: { getSessionFile: () => "/tmp/child-sessions/child.jsonl" },
    extensionRunner: { hasHandlers: () => false },
    dispose: vi.fn(() => {
      h.log.push("dispose");
    }),
  };
}

function makeCtx(): codingAgent.ExtensionContext {
  return {
    cwd: "/repo",
    model: { id: "parent-model" },
    sessionManager: {
      getHeader: () => ({ id: "parent-1" }),
      getSessionFile: () => "/tmp/parent.jsonl",
    },
  } as unknown as codingAgent.ExtensionContext;
}

function baseSpec(overrides: Partial<ChildSessionSpec> = {}): ChildSessionSpec {
  return {
    sessionDir: "/tmp/child-sessions",
    systemPrompt: "child system prompt",
    tools: ["read", "bash"],
    model: { id: "child-model" } as codingAgent.ExtensionContext["model"],
    ...overrides,
  };
}

let agentDir: string;

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "child-session-test-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  h.log.length = 0;
  h.loaderOptions.length = 0;
  h.createSessionOptions.length = 0;
  h.session = makeFakeSession();
  vi.mocked(recordChildSessionStarted).mockClear();
  vi.mocked(recordChildSessionFinished).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

describe("withChildSession lifecycle", () => {
  it("spawns, binds, records started, runs the driver, then settles as done", async () => {
    const result = await withChildSession(makeCtx(), baseSpec(), async (handle) => {
      h.log.push("driver");
      expect(handle.session).toBe(h.session);
      expect(handle.toolCallCount()).toBe(0);
      return "ok";
    });

    expect(result).toBe("ok");
    expect(h.log).toEqual([
      "settings.create",
      "session-manager.create",
      "loader.reload",
      "model-runtime.create",
      "create-agent-session",
      "bind-extensions",
      "record-started",
      "driver",
      "record-finished",
      "dispose",
    ]);
  });

  it("builds the loader with child-session flags and the caller's system prompt", async () => {
    await withChildSession(makeCtx(), baseSpec(), async () => "done");

    const loaderOptions = h.loaderOptions[0] as {
      cwd: string;
      noExtensions: boolean;
      noSkills: boolean;
      noPromptTemplates: boolean;
      noThemes: boolean;
      noContextFiles: boolean;
      systemPromptOverride: () => string;
      appendSystemPromptOverride: () => unknown[];
    };
    expect(loaderOptions.cwd).toBe("/repo");
    expect(loaderOptions.noExtensions).toBe(true);
    expect(loaderOptions.noSkills).toBe(true);
    expect(loaderOptions.noPromptTemplates).toBe(true);
    expect(loaderOptions.noThemes).toBe(true);
    expect(loaderOptions.noContextFiles).toBe(true);
    expect(loaderOptions.systemPromptOverride()).toBe("child system prompt");
    expect(loaderOptions.appendSystemPromptOverride()).toEqual([]);
  });

  it("creates the session with the parent link and the resolved spec", async () => {
    await withChildSession(makeCtx(), baseSpec(), async () => "done");

    expect(vi.mocked(codingAgent.SessionManager.create)).toHaveBeenCalledWith(
      "/repo",
      "/tmp/child-sessions",
      expect.objectContaining({ parentSession: "parent-1" }),
    );
    expect(h.createSessionOptions[0]).toMatchObject({
      cwd: "/repo",
      tools: ["read", "bash"],
      model: { id: "child-model" },
    });
  });

  it("records started and finished link records with the session files", async () => {
    await withChildSession(makeCtx(), baseSpec(), async () => "done");

    expect(recordChildSessionStarted).toHaveBeenCalledWith("parent-1", {
      parentSessionFile: "/tmp/parent.jsonl",
      childSessionFile: "/tmp/child-sessions/child.jsonl",
    });
    expect(recordChildSessionFinished).toHaveBeenCalledWith("parent-1", {
      parentSessionFile: "/tmp/parent.jsonl",
      childSessionFile: "/tmp/child-sessions/child.jsonl",
      toolCalls: 0,
      status: "done",
    });
  });

  it("throws spawn failures out without settling a session", async () => {
    vi.mocked(codingAgent.SessionManager.create).mockImplementationOnce(() => {
      throw new Error("no such directory");
    });

    await expect(withChildSession(makeCtx(), baseSpec(), async () => "unreachable")).rejects.toThrow(
      "no such directory",
    );
    expect(recordChildSessionStarted).not.toHaveBeenCalled();
    expect(recordChildSessionFinished).not.toHaveBeenCalled();
    expect((h.session as FakeSession).dispose).not.toHaveBeenCalled();
  });
});

describe("withChildSession Settle", () => {
  it("settles with an error status and shuts down when the driver throws", async () => {
    await expect(
      withChildSession(makeCtx(), baseSpec(), async () => {
        throw new Error("driver exploded");
      }),
    ).rejects.toThrow("driver exploded");

    expect(recordChildSessionFinished).toHaveBeenCalledWith("parent-1", expect.objectContaining({ status: "error" }));
    expect((h.session as FakeSession).dispose).toHaveBeenCalled();
  });

  it("records an error status when the driver marks the run errored", async () => {
    const result = await withChildSession(makeCtx(), baseSpec(), async (handle) => {
      handle.markError();
      return "still-returns";
    });

    expect(result).toBe("still-returns");
    expect(recordChildSessionFinished).toHaveBeenCalledWith("parent-1", expect.objectContaining({ status: "error" }));
  });

  it("skips session-links records when linkParent is false", async () => {
    await withChildSession(makeCtx(), baseSpec({ linkParent: false }), async () => "done");

    expect(recordChildSessionStarted).not.toHaveBeenCalled();
    expect(recordChildSessionFinished).not.toHaveBeenCalled();
    expect((h.session as FakeSession).dispose).toHaveBeenCalled();
  });
});

describe("withChildSession abort forwarding", () => {
  it("aborts the session without running the driver when the signal is already aborted", async () => {
    const driver = vi.fn(async () => "unreachable");

    await expect(withChildSession(makeCtx(), baseSpec({ signal: AbortSignal.abort() }), driver)).rejects.toThrow(
      /abort/i,
    );

    expect(driver).not.toHaveBeenCalled();
    expect((h.session as FakeSession).abort).toHaveBeenCalled();
    expect(recordChildSessionFinished).toHaveBeenCalledWith("parent-1", expect.objectContaining({ status: "error" }));
    expect((h.session as FakeSession).dispose).toHaveBeenCalled();
  });

  it("aborts the session when the signal fires mid-driver", async () => {
    const controller = new AbortController();
    await withChildSession(makeCtx(), baseSpec({ signal: controller.signal }), async () => {
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return "done";
    });

    expect((h.session as FakeSession).abort).toHaveBeenCalled();
  });

  it("detaches the abort listener after settling", async () => {
    const controller = new AbortController();
    await withChildSession(makeCtx(), baseSpec({ signal: controller.signal }), async () => "done");

    controller.abort();
    expect((h.session as FakeSession).abort).not.toHaveBeenCalled();
  });
});

describe("withChildSession turn limiter", () => {
  it("steers at maxTurns and aborts at maxTurns + 3", async () => {
    const session = h.session as FakeSession;
    await withChildSession(makeCtx(), baseSpec({ maxTurns: 2 }), async () => {
      session.emit({ type: "turn_end" });
      expect(session.steer).not.toHaveBeenCalled();
      session.emit({ type: "turn_end" });
      expect(session.steer).toHaveBeenCalledTimes(1);
      expect(session.abort).not.toHaveBeenCalled();
      session.emit({ type: "turn_end" });
      session.emit({ type: "turn_end" });
      expect(session.abort).not.toHaveBeenCalled();
      session.emit({ type: "turn_end" });
      expect(session.abort).toHaveBeenCalledTimes(1);
      return "done";
    });

    expect(session.steer).toHaveBeenCalledTimes(1);
    expect(session.abort).toHaveBeenCalledTimes(1);
  });

  it("never limits without a positive maxTurns", async () => {
    const session = h.session as FakeSession;
    await withChildSession(makeCtx(), baseSpec({ maxTurns: 0 }), async () => {
      for (let i = 0; i < 8; i++) session.emit({ type: "turn_end" });
      return "done";
    });

    expect(session.steer).not.toHaveBeenCalled();
    expect(session.abort).not.toHaveBeenCalled();
  });
});

describe("withChildSession progress", () => {
  it("emits the usage snapshot with progressContext on start, per tool call, and per turn", async () => {
    const payloads: Record<string, unknown>[] = [];
    const session = h.session as FakeSession;
    await withChildSession(
      makeCtx(),
      baseSpec({
        onProgress: (p) => payloads.push(p as Record<string, unknown>),
        progressContext: { task_index: 2, task_total: 5 },
      }),
      async () => {
        session.emit({ type: "tool_execution_end" });
        session.emit({ type: "tool_execution_end" });
        session.emit({ type: "turn_end" });
        return "done";
      },
    );

    const expected = {
      tool_calls: 2,
      sub_session_file: "/tmp/child-sessions/child.jsonl",
      usage_input: 11,
      usage_output: 7,
      usage_cache_read: 3,
      usage_cache_write: 5,
      usage_cost_usd: 0.25,
      context_percent: 42,
      context_tokens: 8400,
      context_window: 20000,
      task_index: 2,
      task_total: 5,
    };
    expect(payloads[0]).toMatchObject({ ...expected, tool_calls: 0 });
    expect(payloads[1]).toMatchObject({ ...expected, tool_calls: 1 });
    expect(payloads[2]).toEqual(expected);
    expect(payloads[3]).toEqual(expected);
  });

  it("counts tool calls through the handle", async () => {
    const session = h.session as FakeSession;
    let observed = -1;
    await withChildSession(makeCtx(), baseSpec(), async (handle) => {
      session.emit({ type: "tool_execution_end" });
      session.emit({ type: "tool_execution_end" });
      observed = handle.toolCallCount();
      return "done";
    });

    expect(observed).toBe(2);
  });
});

describe("withChildSession resource flags", () => {
  it("leaves skills enabled when skills is true", async () => {
    await withChildSession(makeCtx(), baseSpec({ skills: true }), async () => "done");

    expect(h.loaderOptions[0]).toMatchObject({ noSkills: false });
  });

  it("disables skills by default", async () => {
    await withChildSession(makeCtx(), baseSpec(), async () => "done");

    expect(h.loaderOptions[0]).toMatchObject({ noSkills: true });
  });

  it("merges child extension factories after the caller's by default", async () => {
    const callerFactory = { id: "caller" } as unknown as codingAgent.ExtensionFactory;
    const childFactory = { id: "child" } as unknown as codingAgent.ExtensionFactory;
    const unregister = registerChildExtensionFactory("child-session-test", childFactory);
    try {
      await withChildSession(makeCtx(), baseSpec({ extensionFactories: [callerFactory] }), async () => "done");
      expect(h.loaderOptions[0]).toMatchObject({ extensionFactories: [callerFactory, childFactory] });
    } finally {
      unregister();
    }
  });

  it("skips child extension factories when includeChildExtensions is false", async () => {
    const callerFactory = { id: "caller" } as unknown as codingAgent.ExtensionFactory;
    const childFactory = { id: "child" } as unknown as codingAgent.ExtensionFactory;
    const unregister = registerChildExtensionFactory("child-session-test", childFactory);
    try {
      await withChildSession(
        makeCtx(),
        baseSpec({ extensionFactories: [callerFactory], includeChildExtensions: false }),
        async () => "done",
      );
      expect(h.loaderOptions[0]).toMatchObject({ extensionFactories: [callerFactory] });
    } finally {
      unregister();
    }
  });
});
