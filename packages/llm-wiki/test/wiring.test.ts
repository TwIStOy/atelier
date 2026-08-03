import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runIsolatedSession } from "@htwang-contrib/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapVault } from "../src/core/bootstrap.ts";
import { appendReviewItem, listReviewItems } from "../src/core/review.ts";
import initLlmWiki, { registerWikiLintTool, registerWikiReviewTool } from "../src/index.ts";

const mockConfig = vi.hoisted(() => ({ current: { ingestModel: "", sessionStartNotice: true } }));

vi.mock("@htwang-contrib/common", () => ({
  isExtensionDisabled: () => false,
  createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
  executeSideCall: vi.fn(),
  registerConfigItems: () => {},
  readConfig: () => mockConfig.current,
  resolveModel: () => undefined,
  runIsolatedSession: vi.fn(async () => ({ isError: false, text: "side-call done", toolCalls: 0 })),
}));

type Handler = (...args: unknown[]) => unknown;

interface MockPi {
  tools: Map<string, Record<string, unknown>>;
  handlers: Map<string, Handler>;
  commands: Map<string, Record<string, unknown>>;
  pi: unknown;
}

function createMockPi(): MockPi {
  const tools = new Map<string, Record<string, unknown>>();
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, Record<string, unknown>>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
    registerTool(tool: Record<string, unknown>) {
      tools.set(tool.name as string, tool);
    },
    registerCommand(name: string, _options: Record<string, unknown>) {
      commands.set(name, _options);
    },
  };
  return { tools, handlers, commands, pi };
}

let tmpRoot: string;
let projectDir: string;
let vaultRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-wire-"));
  projectDir = path.join(tmpRoot, "project");
  vaultRoot = path.join(projectDir, ".llm-wiki");
  fs.mkdirSync(path.join(vaultRoot, "wiki", "concepts"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function setup() {
  const mock = createMockPi();
  initLlmWiki(mock.pi as never);
  return mock;
}

function callToolCall(mock: MockPi, toolName: string, input: Record<string, unknown>) {
  const handler = mock.handlers.get("tool_call")!;
  const notify = vi.fn();
  const ctx = { cwd: projectDir, ui: { notify } };
  const result = handler({ type: "tool_call", toolCallId: "t1", toolName, input }, ctx);
  return { result, notify };
}

function callTurnEnd(mock: MockPi): void {
  mock.handlers.get("turn_end")!({ type: "turn_end", turnIndex: 0, message: {}, toolResults: [] });
}

describe("llm-wiki wiring — guardrails", () => {
  it("blocks a direct write into raw/** and notifies the user", () => {
    const mock = setup();
    const target = path.join(vaultRoot, "raw", "sources", "SRC-1", "extracted.md");
    const { result, notify } = callToolCall(mock, "write", { path: target, content: "x" });
    expect(result).toEqual({ block: true, reason: expect.stringMatching(/raw/i) });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("blocks a direct edit into meta/**", () => {
    const mock = setup();
    const target = path.join(vaultRoot, "meta", "registry.json");
    const { result } = callToolCall(mock, "edit", { path: target, edits: [] });
    expect(result).toEqual({ block: true, reason: expect.stringMatching(/meta/i) });
  });

  it("allows a write into wiki/** (no block) and leaves no notification", () => {
    const mock = setup();
    const target = path.join(vaultRoot, "wiki", "concepts", "foo.md");
    const { result, notify } = callToolCall(mock, "write", { path: target, content: "# Foo" });
    expect(result).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it("passes through non-mutating tools", () => {
    const mock = setup();
    const { result } = callToolCall(mock, "read", { path: path.join(vaultRoot, "meta", "registry.json") });
    expect(result).toBeUndefined();
  });
});

describe("llm-wiki wiring — turn-end auto-rebuild", () => {
  it("rebuilds metadata after a wiki page is written directly", () => {
    const mock = setup();
    fs.writeFileSync(
      path.join(vaultRoot, "wiki", "concepts", "foo.md"),
      "---\ntitle: Foo\ntype: concept\n---\n# Foo\n\nBody.\n",
      "utf8",
    );

    callToolCall(mock, "write", { path: path.join(vaultRoot, "wiki", "concepts", "foo.md"), content: "# Foo" });
    expect(fs.existsSync(path.join(vaultRoot, "meta", "registry.json"))).toBe(false);

    callTurnEnd(mock);

    const registryPath = path.join(vaultRoot, "meta", "registry.json");
    expect(fs.existsSync(registryPath)).toBe(true);
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    expect(registry.pages).toHaveLength(1);
    expect(registry.pages[0].id).toBe("concepts/foo");
    expect(fs.existsSync(path.join(vaultRoot, "meta", "backlinks.json"))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, "meta", "index.md"))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, "meta", "log.md"))).toBe(true);
  });

  it("does nothing at turn end when wiki was not touched", () => {
    const mock = setup();
    callTurnEnd(mock);
    expect(fs.existsSync(path.join(vaultRoot, "meta", "registry.json"))).toBe(false);
  });

  it("clears the touched set on session_start so a stale flag never rebuilds", () => {
    const mock = setup();
    callToolCall(mock, "write", { path: path.join(vaultRoot, "wiki", "concepts", "foo.md"), content: "# Foo" });
    mock.handlers.get("session_start")!(
      { type: "session_start", reason: "reload" },
      {
        modelRegistry: { getAvailable: () => [] },
      },
    );
    callTurnEnd(mock);
    expect(fs.existsSync(path.join(vaultRoot, "meta", "registry.json"))).toBe(false);
  });
});

describe("llm-wiki wiring — wiki_rebuild_meta tool", () => {
  it("rebuilds and returns a summary with counts", async () => {
    const mock = setup();
    fs.mkdirSync(path.join(vaultRoot, "wiki", "entities"), { recursive: true });
    fs.writeFileSync(
      path.join(vaultRoot, "wiki", "entities", "bar.md"),
      "---\ntitle: Bar\ntype: entity\n---\n# Bar\n",
      "utf8",
    );

    const tool = mock.tools.get("wiki_rebuild_meta") as {
      execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
    };
    const result = (await tool.execute("t1", {}, undefined, undefined, { cwd: projectDir })) as {
      content: { text: string }[];
      details: { pages: number; sources: number };
    };
    expect(result.details.pages).toBe(1);
    expect(result.content[0].text).toContain("Rebuilt metadata");
    expect(fs.existsSync(path.join(vaultRoot, "meta", "registry.json"))).toBe(true);
  });
});

describe("llm-wiki wiring — wiki_ensure_page tool", () => {
  beforeEach(() => {
    bootstrapVault(vaultRoot, { now: () => new Date(Date.UTC(2024, 0, 5, 9, 0, 0)) });
  });

  function ensureTool(mock: MockPi): {
    execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
  } {
    return mock.tools.get("wiki_ensure_page") as {
      execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
    };
  }

  function ensure(mock: MockPi, params: Record<string, unknown>): Promise<unknown> {
    return ensureTool(mock).execute("t1", params, undefined, undefined, { cwd: projectDir });
  }

  it("registers the wiki_ensure_page tool", () => {
    const mock = setup();
    expect(mock.tools.has("wiki_ensure_page")).toBe(true);
  });

  it("creates a concept page from the template when none exists", async () => {
    const mock = setup();
    const result = (await ensure(mock, { type: "concept", title: "React Hooks" })) as {
      content: { text: string }[];
      details: { created: boolean; id: string; relPath: string; type: string };
    };

    expect(result.details.created).toBe(true);
    expect(result.details.type).toBe("concept");
    expect(result.details.id).toBe("concepts/react-hooks");
    expect(result.details.relPath).toBe("wiki/concepts/react-hooks.md");
    expect(fs.existsSync(path.join(vaultRoot, "wiki", "concepts", "react-hooks.md"))).toBe(true);
    expect(result.content[0].text).toContain("Created concept page");
  });

  it("resolves to the existing page on a second call with the same title (created=false)", async () => {
    const mock = setup();
    await ensure(mock, { type: "concept", title: "React" });
    const result = (await ensure(mock, { type: "concept", title: "React" })) as {
      details: { created: boolean; matchedOn: string; id: string };
    };

    expect(result.details.created).toBe(false);
    expect(result.details.matchedOn).toBe("title");
    expect(fs.readdirSync(path.join(vaultRoot, "wiki", "concepts"))).toHaveLength(1);
  });

  it("marks the vault for a turn-end meta rebuild when it creates a page", async () => {
    const mock = setup();
    const registryPath = path.join(vaultRoot, "meta", "registry.json");

    await ensure(mock, { type: "entity", title: "OpenAI" });

    const stale = JSON.parse(fs.readFileSync(registryPath, "utf8")) as { pages: unknown[] };
    expect(stale.pages).toHaveLength(0);

    callTurnEnd(mock);

    const fresh = JSON.parse(fs.readFileSync(registryPath, "utf8")) as { pages: { id: string }[] };
    expect(fresh.pages).toHaveLength(1);
    expect(fresh.pages[0].id).toBe("entities/openai");
  });
});

describe("llm-wiki wiring — wiki_search tool", () => {
  function writePage(rel: string, content: string): void {
    const abs = path.join(vaultRoot, "wiki", rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }

  function searchTool(mock: MockPi): {
    execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
  } {
    return mock.tools.get("wiki_search") as {
      execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
    };
  }

  it("registers the wiki_search tool", () => {
    const mock = setup();
    expect(mock.tools.has("wiki_search")).toBe(true);
  });

  it("returns keyword-ranked hits from the active vault only", async () => {
    const mock = setup();
    writePage("concepts/react.md", "---\ntitle: React\ntype: concept\n---\n# React\nA UI library.\n");
    writePage("entities/unrelated.md", "---\ntitle: Boring\ntype: entity\n---\n# Boring\n");

    const result = (await searchTool(mock).execute("t1", { query: "react" }, undefined, undefined, {
      cwd: projectDir,
    })) as {
      content: { text: string }[];
      details: { hits: { id: string; matchedBy: string[] }[] };
    };

    const ids = result.details.hits.map((h) => h.id);
    expect(ids).toContain("concepts/react");
    expect(ids).not.toContain("entities/unrelated");
    expect(result.details.hits[0]!.matchedBy).toEqual(["keyword"]);
    expect(result.content[0].text).toContain("concepts/react");
    expect(result.content[0].text).toContain(vaultRoot);
  });

  it("reports zero hits for a query that matches nothing", async () => {
    const mock = setup();
    writePage("concepts/react.md", "---\ntitle: React\n---\n# React\n");
    const result = (await searchTool(mock).execute("t1", { query: "zzzz" }, undefined, undefined, {
      cwd: projectDir,
    })) as { details: { hits: unknown[] } };
    expect(result.details.hits).toEqual([]);
  });
});

describe("llm-wiki wiring — wiki_recall tool", () => {
  const originalHome = process.env.HOME;

  beforeEach(() => {
    process.env.HOME = tmpRoot;
  });
  afterEach(() => {
    process.env.HOME = originalHome;
  });

  function writePage(rel: string, content: string): void {
    const abs = path.join(vaultRoot, "wiki", rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }

  function recallTool(mock: MockPi): {
    execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
  } {
    return mock.tools.get("wiki_recall") as {
      execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
    };
  }

  it("registers the wiki_recall tool", () => {
    const mock = setup();
    expect(mock.tools.has("wiki_recall")).toBe(true);
  });

  it("returns merged keyword + graph hits and annotates the vault(s)", async () => {
    const mock = setup();
    writePage(
      "concepts/react.md",
      "---\ntitle: React\ntype: concept\nsources: [SRC-1]\n---\n# React\n\nSee [[concepts/hooks]].\n",
    );
    writePage("concepts/hooks.md", "---\ntitle: Hooks\ntype: concept\nsources: [SRC-1]\n---\n# Hooks\n");
    writePage("entities/other.md", "---\ntitle: Other\ntype: entity\n---\n# Other\n");

    const result = (await recallTool(mock).execute("t1", { query: "react" }, undefined, undefined, {
      cwd: projectDir,
    })) as {
      content: { text: string }[];
      details: {
        vaults: string[];
        hits: { id: string; matchedBy: string[]; vault: string }[];
      };
    };

    const ids = result.details.hits.map((h) => h.id);
    expect(ids).toContain("concepts/react");
    expect(ids).toContain("concepts/hooks");
    expect(ids).not.toContain("entities/other");

    const react = result.details.hits.find((h) => h.id === "concepts/react")!;
    expect(react.matchedBy).toContain("keyword");
    const hooks = result.details.hits.find((h) => h.id === "concepts/hooks")!;
    expect(hooks.matchedBy).toContain("graph");

    expect(result.details.vaults).toContain(vaultRoot);
    expect(result.content[0].text).toContain("Recalled");
    expect(result.content[0].text).toContain(vaultRoot);
  });
});

describe("llm-wiki wiring — wiki_review tool + /wiki-review command", () => {
  const FIXED_NOW = () => new Date(Date.UTC(2024, 0, 5, 9, 30, 0));

  it("registers both /wiki-review and the wiki_review tool (list/resolve/file in the main session)", () => {
    const mock = setup();
    expect(mock.commands.has("wiki-review")).toBe(true);
    expect(mock.tools.has("wiki_review")).toBe(true);
  });

  it("action=file files an agent item without a packet, dedups repeats, and requires a query for deep_research", async () => {
    const mock = setup();
    registerWikiReviewTool(mock.pi as never);
    const tool = mock.tools.get("wiki_review") as {
      execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
    };

    const filed = (await tool.execute(
      "f1",
      {
        action: "file",
        kind: "question",
        title: "Does the wiki cover X?",
        suggestedAction: "deep_research",
        query: "X explained",
      },
      undefined,
      undefined,
      { cwd: projectDir },
    )) as { content: { text: string }[]; details: { filed: boolean; item: { id: string; packetId?: string } } };
    expect(filed.details.filed).toBe(true);
    expect(filed.details.item.packetId).toBeUndefined();
    expect(filed.content[0].text).toContain(filed.details.item.id);

    const dupe = (await tool.execute(
      "f2",
      {
        action: "file",
        kind: "question",
        title: "Does the wiki cover X?",
        suggestedAction: "deep_research",
        query: "X explained",
      },
      undefined,
      undefined,
      { cwd: projectDir },
    )) as { content: { text: string }[]; details: { filed: boolean; item: { id: string } } };
    expect(dupe.details.filed).toBe(false);
    expect(dupe.details.item.id).toBe(filed.details.item.id);
    expect(dupe.content[0].text).toMatch(/already filed/i);

    await expect(
      tool.execute(
        "f3",
        { action: "file", kind: "question", title: "No query", suggestedAction: "deep_research" },
        undefined,
        undefined,
        { cwd: projectDir },
      ),
    ).rejects.toThrow(/query.*required/i);

    await expect(
      tool.execute("f4", { action: "file", kind: "question", suggestedAction: "skip" }, undefined, undefined, {
        cwd: projectDir,
      }),
    ).rejects.toThrow(/title.*required/i);

    expect(listReviewItems(vaultRoot, { status: "open" })).toHaveLength(1);
  });

  it("lists open items and resolves one through the registered tool", async () => {
    const mock = setup();
    registerWikiReviewTool(mock.pi as never);
    appendReviewItem(
      vaultRoot,
      { packetId: "SRC-2024-01-05-001", kind: "contradiction", title: "RSC vs client", action: "create_page" },
      { now: FIXED_NOW() },
    );

    const tool = mock.tools.get("wiki_review") as {
      execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
    };

    const listed = (await tool.execute("t1", { action: "list" }, undefined, undefined, { cwd: projectDir })) as {
      content: { text: string }[];
      details: { count: number; items: { id: string; title: string }[] };
    };
    expect(listed.details.count).toBe(1);
    expect(listed.details.items[0].title).toBe("RSC vs client");
    expect(listed.content[0].text).toContain("RSC vs client");
    const itemId = listed.details.items[0].id;

    const resolved = (await tool.execute("t2", { action: "resolve", itemId, decision: "skip" }, undefined, undefined, {
      cwd: projectDir,
    })) as { details: { remainingOpen: number } };
    expect(resolved.details.remainingOpen).toBe(0);

    const after = (await tool.execute("t1", { action: "list" }, undefined, undefined, { cwd: projectDir })) as {
      details: { count: number };
    };
    expect(after.details.count).toBe(0);
  });

  it("/wiki-review notifies 'no open items' when the queue is empty", async () => {
    const mock = setup();
    const cmd = mock.commands.get("wiki-review") as { handler: (args: string, ctx: unknown) => Promise<void> };
    const notify = vi.fn();
    await cmd.handler("", { cwd: projectDir, hasUI: true, ui: { notify } });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatch(/no open review items/i);
  });

  it("/wiki-review falls back to a summary when there is no interactive UI", async () => {
    const mock = setup();
    appendReviewItem(
      vaultRoot,
      { packetId: "SRC-2024-01-05-001", kind: "gap", title: "needs a page", action: "deep_research", query: "q" },
      { now: FIXED_NOW() },
    );
    const cmd = mock.commands.get("wiki-review") as { handler: (args: string, ctx: unknown) => Promise<void> };
    const notify = vi.fn();
    await cmd.handler("", { cwd: projectDir, hasUI: false, ui: { notify } });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[0][0]).toContain("needs a page");
    expect(notify.mock.calls[1][0]).toMatch(/interactive terminal/i);
  });

  it("/wiki-review auto-resolves skip items and hands create_page items to a side-call", async () => {
    const mock = setup();
    appendReviewItem(
      vaultRoot,
      { packetId: "SRC-1", kind: "noise", title: "skippable", action: "skip" },
      { now: FIXED_NOW() },
    );
    appendReviewItem(
      vaultRoot,
      { packetId: "SRC-1", kind: "gap", title: "needs a page", action: "create_page" },
      { now: FIXED_NOW() },
    );
    const select = vi.fn();
    const notify = vi.fn();
    const cmd = mock.commands.get("wiki-review") as { handler: (args: string, ctx: unknown) => Promise<void> };

    await cmd.handler("", {
      cwd: projectDir,
      hasUI: true,
      ui: { select, input: vi.fn(), notify },
      isIdle: () => false,
    });

    expect(select).not.toHaveBeenCalled();
    expect(vi.mocked(runIsolatedSession)).toHaveBeenCalledTimes(1);
    const task = vi.mocked(runIsolatedSession).mock.calls[0][1].task as string;
    expect(task).toContain("needs a page");
    expect(notify.mock.calls.some((c) => /Auto-resolved 1 item\(s\) suggested as skip/.test(c[0]))).toBe(true);
    expect(notify.mock.calls.some((c) => /No deep_research items to review/.test(c[0]))).toBe(true);

    const resolved = listReviewItems(vaultRoot, { status: "resolved" });
    expect(resolved.map((e) => ({ title: e.title, action: e.resolvedAction }))).toEqual([
      { title: "skippable", action: "skip" },
    ]);
    expect(listReviewItems(vaultRoot, { status: "open" }).map((e) => e.title)).toEqual(["needs a page"]);
  });

  it("/wiki-review walks only deep_research items interactively and records notes", async () => {
    const mock = setup();
    appendReviewItem(
      vaultRoot,
      { packetId: "SRC-1", kind: "gap", title: "first", action: "deep_research", query: "q1" },
      { now: FIXED_NOW() },
    );
    appendReviewItem(
      vaultRoot,
      { packetId: "SRC-1", kind: "gap", title: "second", action: "deep_research", query: "q2" },
      { now: FIXED_NOW() },
    );

    const selectCalls: string[] = [];
    const selectQueue = ["Create page", "Skip"];
    const select = vi.fn((_title: string, _options: string[]) => {
      selectCalls.push(_title);
      return Promise.resolve(selectQueue.shift());
    });
    const input = vi.fn(() => Promise.resolve("created concepts/x.md"));
    const notify = vi.fn();
    const cmd = mock.commands.get("wiki-review") as { handler: (args: string, ctx: unknown) => Promise<void> };

    await cmd.handler("", { cwd: projectDir, hasUI: true, ui: { select, input, notify } });

    expect(select).toHaveBeenCalledTimes(2);
    expect(input).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls.some((c) => /All deep_research review items resolved/.test(c[0]))).toBe(true);

    expect(listReviewItems(vaultRoot, { status: "open" })).toEqual([]);
    const resolved = listReviewItems(vaultRoot, { status: "resolved" });
    expect(resolved.map((e) => ({ title: e.title, action: e.resolvedAction, note: e.resolutionNote }))).toEqual([
      { title: "first", action: "create_page", note: "created concepts/x.md" },
      { title: "second", action: "skip", note: undefined },
    ]);
  });

  it("/wiki-review stops early when the user picks Stop", async () => {
    const mock = setup();
    appendReviewItem(
      vaultRoot,
      { packetId: "SRC-1", kind: "gap", title: "first", action: "deep_research", query: "q1" },
      { now: FIXED_NOW() },
    );
    appendReviewItem(
      vaultRoot,
      { packetId: "SRC-1", kind: "gap", title: "second", action: "deep_research", query: "q2" },
      { now: FIXED_NOW() },
    );

    const select = vi.fn(() => Promise.resolve("Stop"));
    const notify = vi.fn();
    const cmd = mock.commands.get("wiki-review") as { handler: (args: string, ctx: unknown) => Promise<void> };

    await cmd.handler("", { cwd: projectDir, hasUI: true, ui: { select, input: vi.fn(), notify } });

    expect(select).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls.some((c) => /item\(s\) still open/.test(c[0]))).toBe(true);
    expect(listReviewItems(vaultRoot, { status: "open" }).map((e) => e.title)).toEqual(["first", "second"]);
  });
});

describe("llm-wiki wiring — wiki_lint tool", () => {
  function lintTool(mock: MockPi): {
    execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
  } {
    if (!mock.tools.has("wiki_lint")) registerWikiLintTool(mock.pi as never);
    return mock.tools.get("wiki_lint") as {
      execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
    };
  }

  it("does NOT register wiki_lint in the main session (lint moved to a side-call)", () => {
    const mock = setup();
    expect(mock.tools.has("wiki_lint")).toBe(false);
  });

  it("writes meta/lint-report.md and reports findings", async () => {
    const mock = setup();
    fs.writeFileSync(
      path.join(vaultRoot, "wiki", "concepts", "foo.md"),
      "---\ntitle: Foo\ntype: concept\n---\n[[ghost]]\n",
      "utf8",
    );

    const result = (await lintTool(mock).execute("t1", {}, undefined, undefined, { cwd: projectDir })) as {
      content: { text: string }[];
      details: { summary: { total: number; warnings: number }; reportPath: string };
    };

    expect(result.details.summary.total).toBe(1);
    expect(result.details.summary.warnings).toBe(1);
    expect(fs.existsSync(result.details.reportPath)).toBe(true);
    expect(result.content[0].text).toContain("1 issues");
  });

  it("auto-captures uncaptured inbox files when fix=true", async () => {
    const mock = setup();
    fs.mkdirSync(path.join(vaultRoot, "inbox"), { recursive: true });
    fs.writeFileSync(path.join(vaultRoot, "inbox", "new.md"), "# New\n", "utf8");

    const result = (await lintTool(mock).execute("t1", { fix: true }, undefined, undefined, { cwd: projectDir })) as {
      details: { fixResult: { captured: { relPath: string; packetId: string }[]; remaining: number } | null };
    };

    expect(result.details.fixResult?.captured).toHaveLength(1);
    expect(result.details.fixResult?.captured[0]?.packetId).toMatch(/^SRC-\d{4}-\d{2}-\d{2}-001$/);
    expect(result.details.fixResult?.captured[0]?.relPath).toBe("inbox/new.md");
    expect(result.details.fixResult?.remaining).toBe(0);
  });
});

describe("llm-wiki wiring — wiki_status tool", () => {
  it("registers the wiki_status tool and returns a summary", async () => {
    const mock = setup();
    expect(mock.tools.has("wiki_status")).toBe(true);

    fs.writeFileSync(
      path.join(vaultRoot, "wiki", "concepts", "foo.md"),
      "---\ntitle: Foo\ntype: concept\n---\n# Foo\n",
      "utf8",
    );
    const tool = mock.tools.get("wiki_status") as {
      execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
    };
    const result = (await tool.execute("t1", {}, undefined, undefined, { cwd: projectDir })) as {
      content: { text: string }[];
      details: { pages: number };
    };
    expect(result.details.pages).toBe(1);
    expect(result.content[0].text).toContain("pages: 1");
  });
});

describe("llm-wiki wiring — /wiki-capture command (capture moved to side-call)", () => {
  it("registers /wiki-capture and does NOT register wiki_capture in the main session", () => {
    const mock = setup();
    expect(mock.commands.has("wiki-capture")).toBe(true);
    expect(mock.tools.has("wiki_capture")).toBe(false);
  });
});

describe("llm-wiki wiring — lint/status slash commands", () => {
  it("registers /wiki-lint and /wiki-status", () => {
    const mock = setup();
    expect(mock.commands.has("wiki-lint")).toBe(true);
    expect(mock.commands.has("wiki-status")).toBe(true);
  });
});

describe("llm-wiki wiring — resources_discover (bundled skill + /wiki-query prompt)", () => {
  it("registers a resources_discover handler", () => {
    const mock = setup();
    expect(mock.handlers.has("resources_discover")).toBe(true);
  });

  it("advertises the bundled skill dir and the /wiki-query prompt dir as resolvable paths", () => {
    const mock = setup();
    const handler = mock.handlers.get("resources_discover")!;
    const result = handler({ type: "resources_discover", cwd: projectDir, reason: "startup" }, { cwd: projectDir }) as {
      skillPaths?: string[];
      promptPaths?: string[];
    };

    expect(result.skillPaths).toHaveLength(1);
    expect(result.promptPaths).toHaveLength(1);

    const skillDir = result.skillPaths![0]!;
    const promptDir = result.promptPaths![0]!;
    expect(fs.existsSync(path.join(skillDir, "llm-wiki", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(promptDir, "wiki-query.md"))).toBe(true);
  });
});

describe("llm-wiki wiring — session-start notice", () => {
  beforeEach(() => {
    mockConfig.current = { ingestModel: "", sessionStartNotice: true };
  });

  function callSessionStart(mock: MockPi, cwd: string): { notify: ReturnType<typeof vi.fn> } {
    const notify = vi.fn();
    mock.handlers.get("session_start")!(
      { type: "session_start", reason: "startup" },
      {
        cwd,
        modelRegistry: { getAvailable: () => [] },
        ui: { notify },
      },
    );
    return { notify };
  }

  it("notifies with a one-line wiki status hint when a vault exists on disk", () => {
    const mock = setup();
    fs.writeFileSync(
      path.join(vaultRoot, "wiki", "concepts", "foo.md"),
      "---\ntitle: Foo\ntype: concept\n---\n# Foo\n",
      "utf8",
    );
    fs.mkdirSync(path.join(vaultRoot, "inbox"), { recursive: true });
    fs.writeFileSync(path.join(vaultRoot, "inbox", "new.md"), "x", "utf8");

    const { notify } = callSessionStart(mock, projectDir);

    expect(notify).toHaveBeenCalledTimes(1);
    const msg = notify.mock.calls[0]![0] as string;
    expect(msg).toContain("wiki: 1 pages");
    expect(msg).toContain("1 new source");
  });

  it("is silent when sessionStartNotice is disabled", () => {
    mockConfig.current = { ingestModel: "", sessionStartNotice: false };
    const mock = setup();
    const { notify } = callSessionStart(mock, projectDir);
    expect(notify).not.toHaveBeenCalled();
  });

  it("is silent when no vault exists on disk", () => {
    const mock = setup();
    const cwdWithoutVault = path.join(tmpRoot, "elsewhere");
    fs.mkdirSync(cwdWithoutVault, { recursive: true });
    const { notify } = callSessionStart(mock, cwdWithoutVault);
    expect(notify).not.toHaveBeenCalled();
  });
});
