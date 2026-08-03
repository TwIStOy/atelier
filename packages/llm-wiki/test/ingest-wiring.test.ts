import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { executeSideCallMock, registerConfigItemsMock, readConfigMock, resolveModelMock } = vi.hoisted(() => ({
  executeSideCallMock: vi.fn(),
  registerConfigItemsMock: vi.fn(),
  readConfigMock: vi.fn(() => ({ ingestModel: "", ingestMaxAttempts: 3 })),
  resolveModelMock: vi.fn(() => undefined),
}));

vi.mock("@htwang-contrib/common", () => ({
  isExtensionDisabled: () => false,
  createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
  executeSideCall: executeSideCallMock,
  registerConfigItems: registerConfigItemsMock,
  readConfig: readConfigMock,
  resolveModel: resolveModelMock,
  runIsolatedSession: vi.fn(async () => ({ isError: false, text: "side-call done", toolCalls: 0 })),
}));

import { bootstrapVault } from "../src/core/bootstrap.ts";
import { captureSource } from "../src/core/packet.ts";
import { vaultLayout } from "../src/core/paths.ts";
import { listReviewItems } from "../src/core/review.ts";
import initLlmWiki, { registerWikiIngestTool } from "../src/index.ts";

const FIXED_DATE = () => new Date(Date.UTC(2024, 0, 5, 9, 0, 0));

const ANALYSIS_TEXT = [
  "```wiki-analysis",
  JSON.stringify({
    summary: "Introduces Foo.",
    entities: [],
    concepts: [{ title: "Foo", note: "central" }],
    syntheses: [],
    contradictions: [],
    links: [],
    review: [{ kind: "coverage_gap", title: "examples", action: "deep_research", query: "foo examples" }],
  }),
  "```",
].join("\n");

const GENERATION_TEXT = [
  "```wiki-page:source",
  "---",
  "type: source",
  "title: The Foo Paper",
  "sources: [SRC-2024-01-05-001]",
  "---",
  "# The Foo Paper",
  "",
  "See [[sources/SRC-2024-01-05-001]].",
  "```",
  "```wiki-page:concept",
  "---",
  "type: concept",
  "title: Foo",
  "sources: [SRC-2024-01-05-001]",
  "---",
  "# Foo",
  "",
  "Central idea.",
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
  readConfigMock.mockReturnValue({ ingestModel: "", ingestMaxAttempts: 3 });
  resolveModelMock.mockReturnValue(undefined);

  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-ingest-wire-"));
  projectDir = path.join(tmpRoot, "project");
  vaultRoot = path.join(projectDir, ".llm-wiki");
  bootstrapVault(vaultRoot, { now: FIXED_DATE });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function captureTextSource(body: string): Promise<string> {
  return captureSource(
    { sourceType: "text", text: body, title: "The Foo Paper" },
    { sourcesDir: vaultLayout(vaultRoot).sourcesRoot, now: FIXED_DATE },
  ).then((r) => r.manifest.id);
}

function sideCallReturnsAnalysisThenGeneration(): void {
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

describe("llm-wiki wiring — registrations", () => {
  it("registers /wiki-ingest but NOT wiki_ingest (ingest moved to a side-call)", () => {
    const mock = createMockPi();
    initLlmWiki(mock.pi as never);

    expect(mock.commands.has("wiki-ingest")).toBe(true);
    expect(mock.tools.has("wiki_ingest")).toBe(false);
  });

  it("registers ingestModel and ingestMaxAttempts config items under llm-wiki", () => {
    const mock = createMockPi();
    initLlmWiki(mock.pi as never);

    expect(registerConfigItemsMock).toHaveBeenCalledWith(
      "llm-wiki",
      expect.arrayContaining([
        expect.objectContaining({ key: "ingestModel", type: "select" }),
        expect.objectContaining({ key: "ingestMaxAttempts", type: "number" }),
      ]),
    );
  });
});

describe("llm-wiki wiring — wiki_ingest tool end-to-end", () => {
  it("ingests a pending packet through the executeSideCall boundary", async () => {
    const packetId = await captureTextSource("# Foo");
    sideCallReturnsAnalysisThenGeneration();

    const mock = createMockPi();
    registerWikiIngestTool(mock.pi as never);

    const tool = mock.tools.get("wiki_ingest")!;
    const result = await tool.execute("t1", {}, undefined, undefined, fakeCtx());

    expect(result.details).toMatchObject({ ingested: 1, failed: 0 });
    expect(executeSideCallMock).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(path.join(vaultRoot, "wiki", "sources", "the-foo-paper.md"))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, "wiki", "concepts", "foo.md"))).toBe(true);

    const review = listReviewItems(vaultRoot);
    expect(review).toHaveLength(1);
    expect(review[0].packetId).toBe(packetId);

    const registry = JSON.parse(fs.readFileSync(path.join(vaultRoot, "meta", "registry.json"), "utf8")) as {
      sources: { id: string; ingestStatus: string }[];
    };
    expect(registry.sources[0].ingestStatus).toBe("ingested");
  });

  it("forwards an optional packetId to the batch", async () => {
    await captureTextSource("# Foo");
    const second = await captureSource(
      { sourceType: "text", text: "# Other", title: "Other" },
      { sourcesDir: vaultLayout(vaultRoot).sourcesRoot, now: () => new Date(Date.UTC(2024, 0, 6, 9, 0, 0)) },
    ).then((r) => r.manifest.id);
    sideCallReturnsAnalysisThenGeneration();

    const mock = createMockPi();
    registerWikiIngestTool(mock.pi as never);

    const result = await mock.tools
      .get("wiki_ingest")!
      .execute("t1", { packetId: second }, undefined, undefined, fakeCtx());

    expect(result.details).toMatchObject({ processed: 1 });
    expect((result.details.outcomes as Array<{ packetId: string }>)[0].packetId).toBe(second);
  });

  it("returns an error result when no model is available", async () => {
    await captureTextSource("# Foo");
    const mock = createMockPi();
    registerWikiIngestTool(mock.pi as never);

    const result = await mock.tools.get("wiki_ingest")!.execute("t1", {}, undefined, undefined, {
      cwd: projectDir,
      model: undefined,
      modelRegistry: { getAvailable: () => [] },
    });

    expect(result.content[0].text).toMatch(/no model available/i);
    expect(result.details).toMatchObject({ error: expect.stringMatching(/no model/i) });
    expect(executeSideCallMock).not.toHaveBeenCalled();
  });
});
