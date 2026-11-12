import type { Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { executeSideCall, type SideCallResult } from "@htwang-contrib/common/side-call";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRexTitleConfig, resolveRexTitleModel } from "../src/config.ts";
import { buildTitlePrompt, createTitleUpdater, parseTitle } from "../src/title-updater.ts";

vi.mock("../src/config.ts", () => ({
  loadRexTitleConfig: vi.fn(),
  resolveRexTitleModel: vi.fn(),
}));
vi.mock("@htwang-contrib/common/side-call", () => ({ executeSideCall: vi.fn() }));

const sessionModel = { provider: "magpie", id: "session" };
const titleModel = { provider: "magpie", id: "title" };

function userMessage(text: string): Message {
  return { role: "user", content: text, timestamp: 1_000 };
}

function assistantMessage(text: string): Message {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "test",
    model: "test",
    timestamp: 2_000,
  } as Message;
}

function mockCtx(messages: Message[] = [userMessage("Name the Rex pane")]): ExtensionContext {
  const branch = messages.map((message, index) => ({
    type: "message",
    id: `message:${index}`,
    parentId: index === 0 ? null : `message:${index - 1}`,
    timestamp: "2026-01-01T00:00:00.000Z",
    message,
  }));
  return {
    model: sessionModel,
    modelRegistry: {},
    sessionManager: { getBranch: () => branch },
    ui: { notify: vi.fn() },
  } as unknown as ExtensionContext;
}

function response(answer: string): SideCallResult {
  return {
    ok: true,
    answer,
    stopReason: "stop",
    assistantMessage: {
      role: "assistant",
      content: [{ type: "text", text: answer }],
      api: "openai-completions",
      provider: "test",
      model: "test",
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
  };
}

function mockPi(): ExtensionAPI {
  return { setSessionName: vi.fn() } as unknown as ExtensionAPI;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadRexTitleConfig).mockReturnValue({ model: "" });
  vi.mocked(resolveRexTitleModel).mockReturnValue(undefined);
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
  it("includes every user message in order and excludes assistant output", () => {
    const prompt = buildTitlePrompt([
      userMessage("First build the extension"),
      assistantMessage("I added the command"),
      userMessage("Now rename only the pane"),
      userMessage("Refresh after every user message"),
    ]);

    expect(prompt).toContain('<request index="1">\nFirst build the extension\n</request>');
    expect(prompt).toContain('<request index="2">\nNow rename only the pane\n</request>');
    expect(prompt).toContain('<request index="3">\nRefresh after every user message\n</request>');
    expect(prompt).not.toContain("I added the command");
  });

  it("keeps the head and tail of every request when the transcript is long", () => {
    const prompt = buildTitlePrompt([
      userMessage(`FIRST-${"a".repeat(10_000)}-FIRST-END`),
      userMessage(`SECOND-${"b".repeat(10_000)}-SECOND-END`),
      userMessage(`THIRD-${"c".repeat(10_000)}-THIRD-END`),
    ]);

    for (const request of ["FIRST", "SECOND", "THIRD"]) {
      expect(prompt).toContain(`${request}-`);
      expect(prompt).toContain(`${request}-END`);
    }
  });

  it("returns no prompt when there is no user text", () => {
    expect(buildTitlePrompt([assistantMessage("done")])).toBe("");
    expect(buildTitlePrompt([userMessage("   ")])).toBe("");
  });
});

describe("createTitleUpdater", () => {
  it("uses the independently configured title model", async () => {
    const pi = mockPi();
    const ctx = mockCtx();
    vi.mocked(loadRexTitleConfig).mockReturnValue({ model: "magpie/title" });
    vi.mocked(resolveRexTitleModel).mockReturnValue(titleModel as ExtensionContext["model"]);
    vi.mocked(executeSideCall).mockResolvedValue(response("Configurable title model"));

    const result = await createTitleUpdater(pi).run(ctx);

    expect(result).toEqual({ ok: true, title: "Configurable title model" });
    expect(resolveRexTitleModel).toHaveBeenCalledWith(ctx.modelRegistry, { model: "magpie/title" });
    expect(executeSideCall).toHaveBeenCalledWith(expect.objectContaining({ model: titleModel }));
    expect(pi.setSessionName).toHaveBeenCalledWith("Configurable title model");
  });

  it("uses the current session model when the setting is session default", async () => {
    const pi = mockPi();
    vi.mocked(executeSideCall).mockResolvedValue(response("Session model title"));
    const result = await createTitleUpdater(pi).run(mockCtx());
    expect(result.ok).toBe(true);
    expect(resolveRexTitleModel).not.toHaveBeenCalled();
    expect(executeSideCall).toHaveBeenCalledWith(expect.objectContaining({ model: sessionModel }));
  });

  it("does not call a model or set a title for an empty session", async () => {
    const pi = mockPi();
    const result = await createTitleUpdater(pi).run(mockCtx([]));
    expect(result).toEqual({ ok: false, error: "Start a conversation before generating a Rex title." });
    expect(executeSideCall).not.toHaveBeenCalled();
    expect(pi.setSessionName).not.toHaveBeenCalled();
  });

  it("reports unavailable configured or session models", async () => {
    const pi = mockPi();
    vi.mocked(loadRexTitleConfig).mockReturnValue({ model: "missing" });
    const result = await createTitleUpdater(pi).run(mockCtx());
    expect(result.ok).toBe(false);
    expect(executeSideCall).not.toHaveBeenCalled();
    expect(pi.setSessionName).not.toHaveBeenCalled();
  });

  it("reports model failures without setting a title", async () => {
    const pi = mockPi();
    vi.mocked(executeSideCall).mockResolvedValue({ ok: false, error: "model unavailable" });
    const result = await createTitleUpdater(pi).run(mockCtx());
    expect(result).toEqual({ ok: false, error: "model unavailable" });
    expect(pi.setSessionName).not.toHaveBeenCalled();
  });

  it("times out the model side-call without setting a title", async () => {
    const timeoutController = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutController.signal);
    try {
      const pi = mockPi();
      vi.mocked(executeSideCall).mockImplementation(({ signal }) => {
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve({ ok: false, aborted: true, stopReason: "aborted" }), {
            once: true,
          });
        });
      });

      const run = createTitleUpdater(pi).run(mockCtx());
      await vi.waitFor(() => expect(executeSideCall).toHaveBeenCalled());
      timeoutController.abort();
      const result = await run;

      expect(timeout).toHaveBeenCalledWith(60_000);
      expect(result).toMatchObject({ ok: false, timedOut: true });
      expect(pi.setSessionName).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
    }
  });

  it("cancels the previous request so only the latest title is applied", async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(executeSideCall)
      .mockImplementationOnce(({ signal }) => {
        signals.push(signal);
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve({ ok: false, aborted: true, stopReason: "aborted" }), {
            once: true,
          });
        });
      })
      .mockImplementationOnce(({ signal }) => {
        signals.push(signal);
        return Promise.resolve(response("Latest title"));
      });
    const pi = mockPi();
    const updater = createTitleUpdater(pi);
    const ctx = mockCtx([userMessage("First request")]);

    const first = updater.run(ctx);
    await vi.waitFor(() => expect(executeSideCall).toHaveBeenCalledOnce());
    const second = updater.run(mockCtx([userMessage("First request"), userMessage("Latest request")]));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect(firstResult).toMatchObject({ ok: false, cancelled: true });
    expect(secondResult).toEqual({ ok: true, title: "Latest title" });
    expect(pi.setSessionName).toHaveBeenCalledOnce();
    expect(pi.setSessionName).toHaveBeenCalledWith("Latest title");
  });
});
