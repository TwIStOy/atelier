import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapVault } from "../src/core/bootstrap.ts";
import initLlmWiki from "../src/index.ts";

vi.mock("@htwang-contrib/common", () => ({
  isExtensionDisabled: () => false,
  createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
}));

type Handler = (...args: unknown[]) => unknown;

interface MockPi {
  tools: Map<string, Record<string, unknown>>;
  handlers: Map<string, Handler>;
  pi: unknown;
}

function createMockPi(): MockPi {
  const tools = new Map<string, Record<string, unknown>>();
  const handlers = new Map<string, Handler>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
    registerTool(tool: Record<string, unknown>) {
      tools.set(tool.name as string, tool);
    },
  };
  return { tools, handlers, pi };
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
    mock.handlers.get("session_start")!({ type: "session_start", reason: "reload" });
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
