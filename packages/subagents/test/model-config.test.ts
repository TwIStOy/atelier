import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as codingAgent from "@earendil-works/pi-coding-agent";
import {
  buildAgentPersonaCatalog,
  type ConfigItem,
  clearConfigItems,
  getConfigItems,
  loadSubagentModelConfig,
  runChildAgent,
  setConfigKey,
  writeConfig,
} from "@htwang-contrib/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatSubagentAgentInspect } from "../src/agents-inspect.ts";
import { registerSubagentModelConfig } from "../src/model-config.ts";
import { runParallelBatchSubagent } from "../src/orchestrate-batch.ts";
import { runSingleSubagent } from "../src/orchestrate-single.ts";
import { readSubagentSettings } from "../src/settings.ts";
import { registerSubagentsConfig } from "../src/usage-report.ts";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof codingAgent>()),
  createAgentSession: vi.fn(),
}));

vi.mock("../src/paths.ts", () => ({
  get SUBAGENT_SESSION_DIR() {
    return join(process.env.PI_CODING_AGENT_DIR ?? tmpdir(), "subagents", "session");
  },
}));

const createSession = vi.mocked(codingAgent.createAgentSession);
const models = ["parent", "small-v1", "small-v2", "medium", "large", "cheap"].map(
  (id) =>
    ({ id, name: id, provider: "test", contextWindow: 10000 }) as NonNullable<codingAgent.ExtensionContext["model"]>,
);

function lazySelectOptions(item: ConfigItem): unknown[] {
  if (item.type !== "select" || typeof item.options !== "function") throw new Error("missing model selector");
  return item.options();
}

function expectTierOptions(tierItems: ConfigItem[], expected: unknown[]): void {
  for (const item of tierItems) {
    expect(lazySelectOptions(item)).toEqual(expected);
  }
}

describe("subagent model configuration", () => {
  let dir: string;
  let ctx: codingAgent.ExtensionContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "subagent-models-"));
    vi.stubEnv("XDG_CONFIG_HOME", dir);
    vi.stubEnv("PI_CODING_AGENT_DIR", join(dir, "agent"));
    clearConfigItems("subagents");
    createSession.mockReset();
    vi.spyOn(codingAgent.DefaultResourceLoader.prototype, "reload").mockResolvedValue(undefined);
    vi.spyOn(codingAgent.ModelRuntime, "create").mockResolvedValue({} as codingAgent.ModelRuntime);
    createSession.mockImplementation(async (options) => ({
      session: {
        model: options?.model,
        sessionManager: options?.sessionManager,
        messages: [],
        bindExtensions: async () => {},
        subscribe: () => () => {},
        prompt: async () => {},
        getSessionStats: () => ({ tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0 }),
        getContextUsage: () => undefined,
        dispose: () => {},
      } as unknown as codingAgent.AgentSession,
      extensionsResult: { extensions: [], errors: [], runtime: codingAgent.createExtensionRuntime() },
    }));
    ctx = {
      cwd: dir,
      model: models[0],
      modelRegistry: { getAvailable: () => models },
      sessionManager: {
        getHeader: () => ({ id: "model-test-parent" }),
        getSessionFile: () => "",
      },
    } as unknown as codingAgent.ExtensionContext;
  });

  afterEach(() => {
    clearConfigItems("subagents");
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(agentType = "general-purpose", model?: string) {
    const result = await runChildAgent(
      ctx,
      { task: "inspect", agent_type: agentType, model, sessionDir: join(dir, "sessions") },
      undefined,
    );
    expect(result.isError).toBe(false);
    return createSession.mock.lastCall?.[0]?.model;
  }

  it("uses the current session when no model is selected or a tier is unconfigured", async () => {
    expect(await run()).toBe(models[0]);
    expect(await run("explore")).toBe(models[0]);
    expect(await run("scout")).toBe(models[0]);
    expect(await run("plan")).toBe(models[0]);
    expect(await run("general-purpose", "cheap")).toBe(models[0]);
  });

  it("maps shipped personas to tiers and reads model upgrades on the next run", async () => {
    writeConfig("subagents", {
      modelTiers: { cheap: "test/small-v1", middle: "test/medium", flagship: "test/large" },
    });
    expect(await run("explore")).toBe(models[1]);
    expect(await run("scout")).toBe(models[3]);
    expect(await run("plan")).toBe(models[4]);
    expect(await run()).toBe(models[0]);
    setConfigKey("subagents", "modelTiers.cheap", "test/small-v2");
    expect(await run("explore")).toBe(models[2]);
  });

  it("honors persona config, explicit models, and explicit current-session overrides", async () => {
    writeConfig("subagents", {
      modelTiers: { cheap: "test/small-v1", middle: "test/medium", flagship: "test/large" },
      agentModels: { explore: "flagship" },
    });
    expect(await run("explore")).toBe(models[4]);
    expect(await run("explore", "middle")).toBe(models[3]);
    expect(await run("explore", "test/small-v2")).toBe(models[2]);
    expect(await run("explore", "test/cheap")).toBe(models[5]);
    expect(await run("explore", "")).toBe(models[0]);
    setConfigKey("subagents", "agentModels.explore", "");
    expect(await run("explore")).toBe(models[0]);
    setConfigKey("subagents", "agentModels.explore", "test/small-v2");
    expect(await run("explore")).toBe(models[2]);
  });

  it("preserves parent fallback for unavailable models and malformed configuration", async () => {
    writeConfig("subagents", {
      modelTiers: { cheap: "test/missing", middle: false, flagship: " " },
      agentModels: { " explore ": " cheap ", scout: 42, plan: null, "bad.id": "middle" },
    });
    expect(loadSubagentModelConfig()).toEqual({
      modelTiers: { cheap: "test/missing" },
      agentModels: { explore: "cheap" },
    });
    expect(await run("explore")).toBe(models[0]);
    expect(await run("scout")).toBe(models[0]);
    expect(await run("plan")).toBe(models[0]);
    writeConfig("subagents", { modelTiers: [], agentModels: "invalid" });
    expect(await run("explore")).toBe(models[0]);
  });

  it("registers config controls whose persistence keys drive runtime selection", async () => {
    registerSubagentsConfig();
    registerSubagentModelConfig(buildAgentPersonaCatalog(dir), ctx.modelRegistry);
    const items = getConfigItems("subagents");
    expect(items.some((item) => item.key === "reportUsage")).toBe(true);
    const tierItem = items.find((item) => item.key === "modelTiers.cheap");
    const agentItem = items.find((item) => item.key === "agentModels.explore");
    if (tierItem?.type !== "select" || agentItem?.type !== "select") throw new Error("missing model controls");
    const options = typeof agentItem.options === "function" ? agentItem.options() : agentItem.options;
    expect(options.map((option) => option.value)).toEqual(["", "cheap", "middle", "flagship"]);
    const modelOptions = typeof tierItem.options === "function" ? tierItem.options() : tierItem.options;
    const selectedModel = modelOptions.find((option) => option.value === "test/small-v2");
    expect(selectedModel).toEqual({ label: "test/small-v2", value: "test/small-v2" });
    setConfigKey("subagents", tierItem.key, selectedModel?.value);
    setConfigKey("subagents", agentItem.key, "cheap");
    expect(await run("explore")).toBe(models[2]);
    expect(typeof tierItem.value === "function" ? tierItem.value() : tierItem.value).toBe("test/small-v2");
    setConfigKey("subagents", agentItem.key, "");
    expect(await run("explore")).toBe(models[0]);
  });

  it("offers only currently available models for every tier and refreshes lazy options", () => {
    const available = vi.spyOn(ctx.modelRegistry, "getAvailable").mockReturnValue([models[1], models[3]]);
    registerSubagentModelConfig(buildAgentPersonaCatalog(dir), ctx.modelRegistry);
    const tierItems = getConfigItems("subagents").filter((item) => item.key.startsWith("modelTiers."));
    expect(tierItems).toHaveLength(3);
    expectTierOptions(tierItems, [
      { label: "Current session", value: "" },
      { label: "test/small-v1", value: "test/small-v1" },
      { label: "test/medium", value: "test/medium" },
    ]);
    available.mockReturnValue([models[2]]);
    expectTierOptions(tierItems, [
      { label: "Current session", value: "" },
      { label: "test/small-v2", value: "test/small-v2" },
    ]);
    available.mockReturnValue([]);
    expectTierOptions(tierItems, [{ label: "Current session", value: "" }]);
  });

  it("keeps single and batch orchestration from masking configured persona models", async () => {
    writeConfig("subagents", {
      modelTiers: { cheap: "test/small-v1", middle: "test/medium", flagship: "test/large" },
      agentModels: { explore: "flagship" },
    });
    const args = {
      parentBase: { parent_session_id: "model-test-parent", parent_session_file: "" },
      merged: undefined,
      subagentSettings: readSubagentSettings(),
      onUpdate: undefined,
      globalInherit: undefined,
      globalIsolated: undefined,
      globalAgentType: "explore",
    };
    await runSingleSubagent(ctx, { ...args, task: "inspect", description: "Single" });
    expect(createSession.mock.lastCall?.[0]?.model).toBe(models[4]);
    createSession.mockClear();
    const tasks = [
      { task: "first", description: "First" },
      { task: "second", description: "Second", model: "cheap" },
      { task: "third", description: "Third", model: "" },
    ];
    const limits = { maxConcurrent: 1, maxTotal: 3 };
    await runParallelBatchSubagent(ctx, { ...args, tasks, limits });
    expect(createSession.mock.calls.map(([options]) => options?.model)).toEqual([models[4], models[1], models[0]]);
    createSession.mockClear();
    await runParallelBatchSubagent(ctx, { ...args, tasks, limits, globalModel: "middle" });
    expect(createSession.mock.calls.map(([options]) => options?.model)).toEqual([models[3], models[1], models[0]]);
  });

  it("shows the same resolved model and unset-tier fallback in persona inspection", () => {
    const catalog = buildAgentPersonaCatalog(dir);
    const settings = readSubagentSettings();
    const unset = formatSubagentAgentInspect("explore", catalog, settings, ctx);
    expect(unset).toContain('tier "cheap" is unset; parent session model');
    setConfigKey("subagents", "modelTiers.flagship", "test/large");
    setConfigKey("subagents", "agentModels.explore", "flagship");
    const configured = formatSubagentAgentInspect("explore", catalog, settings, ctx);
    expect(configured).toContain("model or tier before resolve: flagship");
    expect(configured).toContain('large (test/large) — resolved pattern "test/large"');
  });
});
