import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { executeSideCallMock, registerConfigItemsMock, readConfigMock, resolveModelMock } = vi.hoisted(() => ({
  executeSideCallMock: vi.fn(),
  registerConfigItemsMock: vi.fn(),
  readConfigMock: vi.fn(() => ({ ingestModel: "", ingestMaxAttempts: 3, deepResearchMaxResults: 5 })),
  resolveModelMock: vi.fn(() => undefined),
}));

const webToolsMock = vi.hoisted(() => ({
  instantiateProviders: vi.fn(),
  isRateLimitError: vi.fn(() => false),
  resolveApiKey: vi.fn<(name: string) => string | undefined>(() => "fake-key"),
  PROVIDERS: [] as Array<{ name: string; label: string; roles: string[]; envVar: string }>,
}));

vi.mock("@htwang-contrib/common", () => ({
  isExtensionDisabled: () => false,
  createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
  executeSideCall: executeSideCallMock,
  registerConfigItems: registerConfigItemsMock,
  readConfig: readConfigMock,
  resolveModel: resolveModelMock,
}));

vi.mock("@htwang-contrib/web-tools", () => ({
  instantiateProviders: webToolsMock.instantiateProviders,
  isRateLimitError: webToolsMock.isRateLimitError,
  resolveApiKey: webToolsMock.resolveApiKey,
  PROVIDERS: webToolsMock.PROVIDERS,
}));

import { bootstrapVault } from "../src/core/bootstrap.ts";
import { vaultLayout } from "../src/core/paths.ts";
import { listReviewItems } from "../src/core/review.ts";
import initLlmWiki, { registerWikiDeepResearchTool } from "../src/index.ts";

const FIXED_DATE = () => new Date(Date.UTC(2024, 0, 5, 9, 0, 0));

const ANALYSIS_TEXT = [
  "```wiki-analysis",
  JSON.stringify({
    summary: "Introduces Foo via web.",
    entities: [],
    concepts: [{ title: "Foo" }],
    syntheses: [],
    contradictions: [],
    links: [],
    review: [],
  }),
  "```",
].join("\n");

const GENERATION_TEXT = [
  "```wiki-page:source",
  "---",
  "type: source",
  "title: Foo on the Web",
  "sources: [SRC-2024-01-05-001]",
  "---",
  "# Foo on the Web",
  "",
  "See [[sources/SRC-2024-01-05-001]].",
  "```",
].join("\n");

type ToolExecute = (
  toolCallId: string,
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  onUpdate: unknown,
  ctx: Record<string, unknown>,
) => Promise<{ content: { type: string; text: string }[]; details: Record<string, unknown> }>;

interface MockPi {
  tools: Map<string, { execute: ToolExecute }>;
  commands: Map<string, { handler: (args: string, ctx: Record<string, unknown>) => Promise<void> }>;
  pi: unknown;
}

function createMockPi(): MockPi {
  const tools = new Map<string, { execute: ToolExecute }>();
  const commands = new Map<string, { handler: (args: string, ctx: Record<string, unknown>) => Promise<void> }>();
  const pi = {
    on() {},
    registerTool(tool: { name: string; execute: ToolExecute }) {
      tools.set(tool.name, { execute: tool.execute });
    },
    registerCommand(name: string, options: { handler: (args: string, ctx: Record<string, unknown>) => Promise<void> }) {
      commands.set(name, { handler: options.handler });
    },
  };
  return { tools, commands, pi };
}

let tmpRoot: string;
let projectDir: string;
let vaultRoot: string;

beforeEach(() => {
  vi.clearAllMocks();
  readConfigMock.mockReturnValue({ ingestModel: "", ingestMaxAttempts: 3, deepResearchMaxResults: 5 });
  resolveModelMock.mockReturnValue(undefined);
  webToolsMock.resolveApiKey.mockReturnValue("fake-key");
  webToolsMock.isRateLimitError.mockReturnValue(false);

  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-research-wire-"));
  projectDir = path.join(tmpRoot, "project");
  vaultRoot = path.join(projectDir, ".llm-wiki");
  bootstrapVault(vaultRoot, { now: FIXED_DATE });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function fileDeepResearchItem(query: string, suffix = "01"): string {
  const id = `REV-20240105T090000-${suffix}`;
  fs.appendFileSync(
    vaultLayout(vaultRoot).review,
    `${JSON.stringify({
      schemaVersion: 1,
      id,
      filedAt: FIXED_DATE().toISOString(),
      packetId: "SRC-2024-01-05-000",
      kind: "coverage_gap",
      title: `research ${suffix}`,
      action: "deep_research",
      status: "open",
      query,
    })}\n`,
  );
  return id;
}

function wireFakeProvider(opts: {
  searchResults: Array<{ url: string; title?: string }>;
  fetchText?: (url: string) => string;
  searchThrow?: (query: string) => boolean;
}): void {
  webToolsMock.instantiateProviders.mockReturnValue({
    providerNames: ["fake"],
    providers: [
      {
        name: "fake",
        provider: {
          name: "fake",
          label: "Fake",
          envVar: "FAKE_KEY",
          async search(query: string) {
            if (opts.searchThrow?.(query)) throw new Error("provider down");
            return {
              query,
              results: opts.searchResults.map((r) => ({ title: r.title ?? r.url, url: r.url, snippet: "" })),
            };
          },
          async fetch(url: string) {
            return { text: opts.fetchText ? opts.fetchText(url) : `# ${url}\n\nfetched body`, title: url };
          },
        },
      },
    ],
  });
}

function sideCallIngestsSuccessfully(): void {
  executeSideCallMock.mockImplementation(async (opts: { systemPrompt: string }) => {
    if (opts.systemPrompt.includes("STEP: analysis")) {
      return { ok: true, answer: ANALYSIS_TEXT, assistantMessage: {}, stopReason: "stop" };
    }
    if (opts.systemPrompt.includes("STEP: generation")) {
      return { ok: true, answer: GENERATION_TEXT, assistantMessage: {}, stopReason: "stop" };
    }
    return { ok: false, error: "unknown step" };
  });
}

const fakeCtx = (): Record<string, unknown> => ({
  cwd: projectDir,
  model: { provider: "test", id: "m1" },
  modelRegistry: { getAvailable: () => [] },
  ui: { notify() {}, setWorkingMessage() {} },
});

describe("llm-wiki deep-research wiring — registrations", () => {
  it("registers /wiki-research but NOT wiki_deep_research (research moved to a side-call)", () => {
    const mock = createMockPi();
    initLlmWiki(mock.pi as never);

    expect(mock.commands.has("wiki-research")).toBe(true);
    expect(mock.tools.has("wiki_deep_research")).toBe(false);
  });

  it("registers the deepResearchMaxResults config item under llm-wiki", () => {
    const mock = createMockPi();
    initLlmWiki(mock.pi as never);

    expect(registerConfigItemsMock).toHaveBeenCalledWith(
      "llm-wiki",
      expect.arrayContaining([expect.objectContaining({ key: "deepResearchMaxResults", type: "number" })]),
    );
  });
});

describe("llm-wiki deep-research wiring — wiki_deep_research tool", () => {
  it("searches, captures, ingests, and resolves the item end-to-end", async () => {
    const itemId = fileDeepResearchItem("foo examples");
    wireFakeProvider({ searchResults: [{ url: "https://a.example" }] });
    sideCallIngestsSuccessfully();

    const mock = createMockPi();
    registerWikiDeepResearchTool(mock.pi as never);

    const result = await mock.tools.get("wiki_deep_research")!.execute("t1", {}, undefined, undefined, fakeCtx());

    expect(result.details).toMatchObject({ resolved: 1, processed: 1 });
    const outcome = (result.details.outcomes as Array<{ itemId: string; status: string; captured: number }>)[0];
    expect(outcome.itemId).toBe(itemId);
    expect(outcome.status).toBe("resolved");
    expect(outcome.captured).toBe(1);

    const items = listReviewItems(vaultRoot);
    expect(items.find((i) => i.id === itemId)?.status).toBe("resolved");
    expect(executeSideCallMock).toHaveBeenCalled();
  });

  it("leaves the item open when search throws on every provider", async () => {
    const itemId = fileDeepResearchItem("boom");
    wireFakeProvider({ searchResults: [], searchThrow: () => true });
    sideCallIngestsSuccessfully();

    const mock = createMockPi();
    registerWikiDeepResearchTool(mock.pi as never);

    const result = await mock.tools.get("wiki_deep_research")!.execute("t1", {}, undefined, undefined, fakeCtx());

    expect(result.details).toMatchObject({ resolved: 0, leftOpen: 1 });
    expect(listReviewItems(vaultRoot).find((i) => i.id === itemId)?.status).toBe("open");
  });

  it("restricts to a single reviewItemId when provided", async () => {
    fileDeepResearchItem("first");
    const second = fileDeepResearchItem("second", "02");
    wireFakeProvider({
      searchResults: [{ url: "https://x.example" }],
    });
    sideCallIngestsSuccessfully();

    const mock = createMockPi();
    registerWikiDeepResearchTool(mock.pi as never);

    const result = await mock.tools
      .get("wiki_deep_research")!
      .execute("t1", { reviewItemId: second }, undefined, undefined, fakeCtx());

    expect(result.details).toMatchObject({ processed: 1 });
    expect((result.details.outcomes as Array<{ itemId: string }>)[0].itemId).toBe(second);
  });

  it("honours a per-call maxResults override over the config default", async () => {
    fileDeepResearchItem("many");
    let observed: number | undefined;
    webToolsMock.instantiateProviders.mockReturnValue({
      providerNames: ["fake"],
      providers: [
        {
          name: "fake",
          provider: {
            name: "fake",
            label: "Fake",
            envVar: "FAKE_KEY",
            async search(_query: string, maxResults: number) {
              observed = maxResults;
              return { query: _query, results: [] };
            },
            async fetch(url: string) {
              return { text: `# ${url}`, title: url };
            },
          },
        },
      ],
    });

    const mock = createMockPi();
    registerWikiDeepResearchTool(mock.pi as never);

    await mock.tools.get("wiki_deep_research")!.execute("t1", { maxResults: 3 }, undefined, undefined, fakeCtx());

    expect(observed).toBe(3);
  });

  it("errors clearly when no search provider is configured", async () => {
    fileDeepResearchItem("q");
    webToolsMock.resolveApiKey.mockReturnValue(undefined);
    webToolsMock.instantiateProviders.mockReturnValue({ providerNames: [], providers: [] });

    const mock = createMockPi();
    registerWikiDeepResearchTool(mock.pi as never);

    const result = await mock.tools.get("wiki_deep_research")!.execute("t1", {}, undefined, undefined, fakeCtx());

    expect(result.content[0].text).toMatch(/no search provider/i);
    expect(result.details).toMatchObject({ error: expect.stringMatching(/no search provider/i) });
  });
});
