import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Api,
  type AssistantMessage,
  type ClassifierResult,
  createAssistantMessageEventStream,
  createProvider,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type Model,
  type ProviderClassifier,
  type ProviderStreams,
  Type,
} from "@earendil-works/pi-ai";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionContext,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  clearConfigItems,
  getConfigItems,
  getEffectiveContextUsage,
  getVirtualModelStatus,
  setConfigKey,
  setVirtualModelStatus,
  writeConfig,
} from "@htwang-contrib/common";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import virtualModel, { TIER_ENTRY } from "../src/index.ts";

const models: Model<Api>[] = ["flash", "middle", "flagship", "judge"].map((id, index) => ({
  id,
  name: id,
  provider: "test-router",
  api: "test-chat",
  baseUrl: "https://unused.invalid",
  reasoning: false,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: [200_000, 400_000, 100_000, 200_000][index],
  maxTokens: 8192,
}));

function answer(model: Model<Api>, text = "Done"): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    provider: model.provider,
    api: model.api,
    model: model.id,
    stopReason: "stop",
    timestamp: Date.now(),
    usage: {
      input: 10,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 11,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

function decision(tier: string): ClassifierResult {
  return {
    api: "test-classifier",
    provider: "test-router",
    model: "jev",
    timestamp: Date.now(),
    stopReason: "stop",
    answers: { model: { type: "choice", choice: tier, probabilities: { [tier]: 1 }, confidence: 1 } },
  };
}

let directory: string;
let sessions: AgentSession[];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pi-virtual-model-"));
  sessions = [];
  vi.stubEnv("XDG_CONFIG_HOME", directory);
  writeConfig("virtual-model", {
    flashModel: "test-router/flash",
    middleModel: "test-router/middle",
    flagshipModel: "test-router/flagship",
    judgeModel: "test-router/jev",
    judgeTimeoutMs: 5000,
  });
});

afterEach(() => {
  for (const session of sessions) {
    setVirtualModelStatus(session.sessionManager.getSessionId(), undefined);
    session.dispose();
  }
  clearConfigItems("virtual-model");
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

async function setup(manager = SessionManager.inMemory(directory)) {
  let context: ExtensionContext | undefined;
  const classify = vi.fn<ProviderClassifier["classify"]>().mockResolvedValue(decision("middle"));
  const reply = vi.fn((model: Model<Api>): AssistantMessage => answer(model, model.id === "judge" ? "middle" : "Done"));
  const stream: ProviderStreams["streamSimple"] = (model) => {
    const output = reply(model);
    const events = createAssistantMessageEventStream();
    events.push({ type: "start", partial: output });
    if (output.stopReason === "error" || output.stopReason === "aborted") {
      events.push({ type: "error", reason: output.stopReason, error: output });
    } else {
      events.push({
        type: "done",
        reason: output.stopReason === "pending" ? "stop" : output.stopReason,
        message: output,
      });
    }
    return events;
  };
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  runtime.registerNativeProvider(
    createProvider({
      id: "test-router",
      auth: { apiKey: { name: "Test", resolve: async () => ({ auth: { apiKey: "test" }, source: "test" }) } },
      models: [
        ...models,
        {
          type: "classifier",
          id: "jev",
          name: "Jev test",
          provider: "test-router",
          api: "test-classifier",
          baseUrl: "https://unused.invalid",
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200_000,
        },
      ],
      api: { stream, streamSimple: stream },
      classifiers: { "test-classifier": { classify } },
    }),
  );
  await runtime.setRuntimeApiKey("test-router", "test");
  const settings = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: "Follow the project rules",
    extensionFactories: [
      virtualModel,
      (pi) => {
        pi.on("session_start", (_event, ctx) => {
          context = ctx;
        });
      },
    ],
  });
  await loader.reload();
  expect(loader.getExtensions().errors).toEqual([]);
  const { session } = await createAgentSession({
    cwd: directory,
    agentDir: directory,
    modelRuntime: runtime,
    model: models[0],
    resourceLoader: loader,
    sessionManager: manager,
    settingsManager: settings,
    tools: ["inspect"],
    customTools: [
      {
        name: "inspect",
        label: "Inspect",
        description: "Read diagnostic data",
        parameters: Type.Object({}),
        execute: async () => ({
          content: [{ type: "text", text: `${"trace\n".repeat(1000)}subtle-race-at-end` }],
          details: {},
        }),
      },
    ],
  });
  sessions.push(session);
  await session.bindExtensions({});
  const virtual = runtime.getModel("virtual", "auto");
  if (!virtual) throw new Error("Virtual model not registered");
  await session.setModel(virtual);
  await runtime.refresh({ allowNetwork: false });
  expect(runtime.hasConfiguredAuth("test-router"), runtime.getError()).toBe(true);
  if (!context) throw new Error("Missing extension context");
  return { session, manager, runtime, virtual, classify, reply, context };
}

describe("virtual model routing through Pi", () => {
  test("starts with flash limits and publishes a new route before its physical response", async () => {
    const { session, context, classify, reply } = await setup();
    expect(session.model?.contextWindow).toBe(200_000);
    expect(getVirtualModelStatus(context)).toMatchObject({ tier: "flash", physicalModel: { id: "flash" } });
    expect(context.getContextUsage()?.contextWindow).toBe(200_000);
    reply.mockImplementationOnce((model) => {
      expect(session.model?.contextWindow).toBe(400_000);
      expect(getVirtualModelStatus(context)).toMatchObject({ tier: "middle", physicalModel: { id: "middle" } });
      return answer(model);
    });
    await session.prompt("Implement");
    classify.mockResolvedValue(decision("flagship"));
    reply.mockImplementationOnce((model) => {
      expect(session.model?.contextWindow).toBe(100_000);
      expect(context.getContextUsage()?.contextWindow).toBe(400_000);
      const usage = getEffectiveContextUsage(context);
      expect(usage?.contextWindow).toBe(100_000);
      expect(usage?.percent).toBe((usage!.tokens! / 100_000) * 100);
      expect(getVirtualModelStatus(context)).toMatchObject({ tier: "flagship", physicalModel: { id: "flagship" } });
      return { ...answer(model), stopReason: "error", errorMessage: "upstream failed" };
    });
    await session.prompt("Hard debugging");
    expect(getEffectiveContextUsage(context)?.contextWindow).toBe(100_000);
    expect(getVirtualModelStatus(context)?.tier).toBe("flagship");
  });

  test("switching away hides the route, and switching back restores its limits", async () => {
    const { session, virtual, context } = await setup();
    await session.prompt("Implement");
    await session.setModel(models[2]);
    expect(getVirtualModelStatus(context)).toBeUndefined();
    expect(getEffectiveContextUsage(context)?.contextWindow).toBe(100_000);
    await session.setModel(virtual);
    expect(session.model?.contextWindow).toBe(400_000);
    expect(getVirtualModelStatus(context)?.tier).toBe("middle");
  });

  test("direct summary requests do not overwrite the published conversation route", async () => {
    const { session, context, runtime, virtual } = await setup();
    await session.prompt("Implement");
    setConfigKey("virtual-model", "middleModel", "test-router/flagship");
    const route = await runtime.resolveModel(virtual, [], { reason: "direct", thinkingLevel: "off" });
    expect(route.model.id).toBe("flagship");
    expect(getVirtualModelStatus(context)?.physicalModel.id).toBe("middle");
    expect(session.model?.contextWindow).toBe(400_000);
  });

  test("Pi compacts for a smaller physical window before sending the routed request", async () => {
    const { session, classify, reply, manager, context } = await setup();
    session.setAutoCompactionEnabled(true);
    classify.mockResolvedValueOnce(decision("flash")).mockResolvedValueOnce(decision("flagship"));
    reply.mockImplementationOnce((model) => {
      const result = answer(model, "Earlier findings and implementation details\n".repeat(6000));
      result.usage.input = 30_000;
      result.usage.output = 60_000;
      result.usage.totalTokens = 90_000;
      return result;
    });
    await session.prompt("Inspect");
    expect(manager.getEntries().some((entry) => entry.type === "compaction")).toBe(false);
    await session.prompt("Difficult follow-up");
    expect(manager.getEntries().some((entry) => entry.type === "compaction")).toBe(true);
    expect(reply.mock.calls.map(([model]) => model.id)).toEqual(["flash", "flagship", "flagship"]);
    expect(session.messages.at(-1)).toMatchObject({ role: "assistant", model: "flagship", stopReason: "stop" });
    expect(getEffectiveContextUsage(context)?.contextWindow).toBe(100_000);
  });
  test("raises tiers, never lowers them, and stops judging at flagship", async () => {
    const { session, classify, reply, manager } = await setup();
    classify
      .mockResolvedValueOnce(decision("flash"))
      .mockResolvedValueOnce(decision("middle"))
      .mockResolvedValueOnce(decision("flash"))
      .mockResolvedValueOnce(decision("flagship"));
    for (const prompt of ["Lookup", "Implement", "Thanks", "Hard debugging", "Another lookup"]) {
      await session.prompt(prompt);
    }
    expect(reply.mock.calls.map(([model]) => model.id)).toEqual(["flash", "middle", "middle", "flagship", "flagship"]);
    expect(classify).toHaveBeenCalledTimes(4);
    expect(session.model?.id).toBe("auto");
    expect(
      manager.getEntries().filter((entry) => entry.type === "custom" && entry.customType === TIER_ENTRY),
    ).toHaveLength(2);
    const request = classify.mock.calls[0][1];
    expect(JSON.stringify(request.state)).toContain("Follow the project rules");
    expect(JSON.stringify(request.state)).toContain("Read diagnostic data");
  });

  test("reassesses after tool results and includes their full output", async () => {
    const { session, classify, reply } = await setup();
    classify.mockResolvedValueOnce(decision("flash")).mockResolvedValueOnce(decision("flagship"));
    reply.mockImplementationOnce((model) => ({
      ...answer(model),
      content: [{ type: "toolCall", id: "inspect-1", name: "inspect", arguments: {} }],
      stopReason: "toolUse",
    }));
    await session.prompt("Investigate");
    expect(reply.mock.calls.map(([model]) => model.id)).toEqual(["flash", "flagship"]);
    expect(JSON.stringify(classify.mock.calls[1][1].state)).toContain("subtle-race-at-end");
  });

  test("reload, disk resume, compaction, tree navigation and model reselection retain the floor", async () => {
    const manager = SessionManager.create(directory, join(directory, "sessions"));
    const first = await setup(manager);
    await first.session.prompt("Implement");
    const earlier = manager.getEntries().find((entry) => entry.type === "message" && entry.message.role === "user");
    if (!earlier) throw new Error("No user entry");
    await first.session.setModel(models[0]);
    await first.session.setModel(first.virtual);
    first.session.dispose();
    const file = manager.getSessionFile();
    if (!file) throw new Error("No session file");
    const restored = SessionManager.open(file);
    restored.branch(earlier.id);
    restored.appendCompaction("Previous investigation", earlier.id, 5000);
    const next = await setup(restored);
    expect(next.session.model?.contextWindow).toBe(400_000);
    expect(getVirtualModelStatus(next.context)?.tier).toBe("middle");
    next.classify.mockResolvedValue(decision("flash"));
    await next.session.prompt("Simple lookup");
    expect(next.reply.mock.calls.map(([model]) => model.id)).toEqual(["middle"]);
    const direct = await next.runtime
      .streamSimple(next.virtual, { messages: [{ role: "user", content: "Summarize", timestamp: 1 }] })
      .result();
    expect(direct.model).toBe("middle");
    expect(next.classify).toHaveBeenCalledTimes(1);
  });

  test("a new session starts at flash; forks inherit their copied tier history", async () => {
    const source = await setup(SessionManager.create(directory, join(directory, "sessions")));
    await source.session.prompt("Implement");
    const file = source.manager.getSessionFile();
    if (!file) throw new Error("No session file");
    const forked = await setup(SessionManager.forkFrom(file, directory, join(directory, "forks")));
    forked.classify.mockResolvedValue(decision("flash"));
    await forked.session.prompt("Lookup");
    expect(forked.reply.mock.calls[0][0].id).toBe("middle");
    const fresh = await setup();
    fresh.classify.mockResolvedValue(decision("flash"));
    await fresh.session.prompt("Lookup");
    expect(fresh.reply.mock.calls[0][0].id).toBe("flash");
  });

  test("supports a normal chat judge and reloads configuration for the next request", async () => {
    const { session, reply, classify } = await setup();
    setConfigKey("virtual-model", "judgeModel", "test-router/judge");
    await session.prompt("Implement");
    expect(reply.mock.calls.map(([model]) => model.id)).toEqual(["judge", "middle"]);
    expect(classify).not.toHaveBeenCalled();
    setConfigKey("virtual-model", "middleModel", "test-router/flagship");
    await session.prompt("Continue");
    expect(reply.mock.calls.map(([model]) => model.id)).toEqual(["judge", "middle", "judge", "flagship"]);
  });

  test.each(["invalid-choice", "provider-error", "aborted"])(
    "a %s judgment fails without dispatch or promotion",
    async (failure) => {
      const { session, manager, reply, classify } = await setup();
      classify.mockResolvedValue(
        failure === "invalid-choice"
          ? decision("unknown")
          : {
              ...decision("flagship"),
              stopReason: failure === "aborted" ? "aborted" : "error",
              errorMessage: "judge unavailable",
            },
      );
      await session.prompt("Implement");
      expect(reply).not.toHaveBeenCalled();
      expect(manager.getEntries().some((entry) => entry.type === "custom" && entry.customType === TIER_ENTRY)).toBe(
        false,
      );
      expect(session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "error" });
    },
  );

  test("cancellation aborts an in-flight judge and never records a late decision", async () => {
    const { session, classify, manager, reply } = await setup();
    let release: ((result: ClassifierResult) => void) | undefined;
    classify.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = session.prompt("Implement");
    await vi.waitFor(() => expect(classify).toHaveBeenCalledOnce());
    const aborted = session.abort();
    release?.(decision("flagship"));
    await Promise.all([pending, aborted]);
    expect(reply).not.toHaveBeenCalled();
    expect(manager.getEntries().some((entry) => entry.type === "custom" && entry.customType === TIER_ENTRY)).toBe(
      false,
    );
    expect(classify.mock.calls[0][2]?.signal?.aborted).toBe(true);
  });

  test("timeouts stop judgments without changing the tier", async () => {
    const { session, classify, manager } = await setup();
    setConfigKey("virtual-model", "judgeTimeoutMs", 20);
    classify.mockImplementation(
      (_model, _context, options) =>
        new Promise((resolve) => {
          options?.signal?.addEventListener(
            "abort",
            () => resolve({ ...decision("flagship"), stopReason: "aborted" }),
            { once: true },
          );
        }),
    );
    await session.prompt("Implement");
    expect(classify.mock.calls[0][2]?.signal?.aborted).toBe(true);
    expect(manager.getEntries().some((entry) => entry.type === "custom" && entry.customType === TIER_ENTRY)).toBe(
      false,
    );
  });

  test("direct and retry requests use the stored floor without another judgment", async () => {
    const { session, runtime, virtual, classify } = await setup();
    await session.prompt("Implement");
    for (const reason of ["retry", "direct"] as const) {
      const route = await runtime.resolveModel(virtual, [], {
        reason,
        thinkingLevel: "high",
        failed: { ...answer(models[1]), stopReason: "error" },
      });
      expect(route.model.id).toBe("middle");
      expect(route.thinkingLevel).toBe("off");
    }
    expect(classify).toHaveBeenCalledOnce();
  });

  test("a failed physical request still retains its promoted tier", async () => {
    const { session, classify, reply } = await setup();
    reply.mockImplementationOnce((model) => ({
      ...answer(model),
      stopReason: "error",
      errorMessage: "upstream failed",
    }));
    await session.prompt("Implement");
    classify.mockResolvedValue(decision("flash"));
    await session.prompt("Lookup");
    expect(reply.mock.calls.map(([model]) => model.id)).toEqual(["middle", "middle"]);
  });

  test("retrying a failed first judgment cannot silently fall back to flash", async () => {
    const { runtime, virtual, classify } = await setup();
    classify.mockResolvedValue({ ...decision("flash"), stopReason: "error", errorMessage: "unavailable" });
    await expect(runtime.resolveModel(virtual, [], { reason: "user", thinkingLevel: "off" })).rejects.toThrow(
      "unavailable",
    );
    await expect(runtime.resolveModel(virtual, [], { reason: "retry", thinkingLevel: "off" })).rejects.toThrow(
      "unavailable",
    );
    expect(classify).toHaveBeenCalledTimes(2);
  });

  test("a malformed chat judge answer cannot dispatch a physical task model", async () => {
    const { session, reply } = await setup();
    setConfigKey("virtual-model", "judgeModel", "test-router/judge");
    reply.mockImplementation((model) => answer(model, "I think flagship is appropriate"));
    await session.prompt("Implement");
    expect(reply.mock.calls.map(([model]) => model.id)).toEqual(["judge"]);
    expect(session.messages.at(-1)).toMatchObject({
      stopReason: "error",
      errorMessage: expect.stringContaining("invalid tier"),
    });
  });

  test("a failed new judgment cannot be bypassed on retry even with an existing floor", async () => {
    const { runtime, virtual, classify, session } = await setup();
    await session.prompt("Implement");
    classify.mockResolvedValue({ ...decision("flagship"), stopReason: "error", errorMessage: "unavailable" });
    await expect(
      runtime.resolveModel(virtual, [], { reason: "user", thinkingLevel: "off", state: { tier: "middle" } }),
    ).rejects.toThrow("unavailable");
    await expect(
      runtime.resolveModel(virtual, [], { reason: "retry", thinkingLevel: "off", state: { tier: "middle" } }),
    ).rejects.toThrow("unavailable");
    expect(classify).toHaveBeenCalledTimes(3);
  });

  test("an already-aborted request starts no judgment and persists no state", async () => {
    const { runtime, virtual, classify, manager } = await setup();
    await expect(
      runtime.resolveModel(virtual, [], { reason: "user", thinkingLevel: "off", signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(classify).not.toHaveBeenCalled();
    expect(manager.getEntries().some((entry) => entry.type === "custom" && entry.customType === TIER_ENTRY)).toBe(
      false,
    );
  });

  test("image markers reach the judge without forwarding image bytes", async () => {
    const { runtime, virtual, classify } = await setup();
    await runtime.resolveModel(
      virtual,
      [
        {
          role: "user",
          timestamp: 1,
          content: [
            { type: "text", text: "Explain this screenshot" },
            { type: "image", mimeType: "image/png", data: "do-not-forward-binary-data" },
          ],
        },
      ],
      { reason: "user", thinkingLevel: "off" },
    );
    const state = JSON.stringify(classify.mock.calls[0][1].state);
    expect(state).toContain("image/png");
    expect(state).not.toContain("do-not-forward-binary-data");
  });

  test("rejects virtual targets and exposes both classifier and chat judge settings", async () => {
    const { session, classify } = await setup();
    const items = getConfigItems("virtual-model");
    const judge = items.find((item) => item.key === "judgeModel");
    if (judge?.type !== "select" || typeof judge.options !== "function") throw new Error("Missing judge options");
    const values = judge.options().map((item) => item.value);
    expect(values).toContain("test-router/jev");
    expect(values).toContain("test-router/judge");
    expect(values).not.toContain("virtual/auto");
    setConfigKey("virtual-model", "flashModel", "virtual/auto");
    await session.prompt("Lookup");
    expect(classify).not.toHaveBeenCalled();
    expect(session.messages.at(-1)).toMatchObject({
      stopReason: "error",
      errorMessage: expect.stringContaining("physical model"),
    });
  });
});
