import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseSnippet,
  expandPositional,
  expandSnippet,
  discoverSnippets,
  registerSnippetCommand,
} from "./snippets.ts";
import type { Snippet } from "./snippets.ts";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

let tmpBase: string;
let origHome: string;

beforeEach(() => {
  tmpBase = mkdtempSync(join(tmpdir(), "snippet-core-test-"));
  origHome = process.env.HOME ?? "";
  process.env.HOME = tmpBase;
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(tmpBase, { recursive: true, force: true });
});

describe("parseSnippet", () => {
  test("extracts description, argumentHint, and body from frontmatter", () => {
    writeFileSync(
      join(tmpBase, "review.md"),
      "---\ndescription: Review code\nargument-hint: <file> [focus]\n---\nReview $1.\n",
    );
    const result = parseSnippet(join(tmpBase, "review.md"), "user");
    expect(result.name).toBe("review");
    expect(result.description).toBe("Review code");
    expect(result.argumentHint).toBe("<file> [focus]");
    expect(result.body).toBe("Review $1.");
    expect(result.source).toBe("user");
  });

  test("returns full content as body when no frontmatter", () => {
    writeFileSync(join(tmpBase, "bare.md"), "Just some text.\n");
    const result = parseSnippet(join(tmpBase, "bare.md"), "project");
    expect(result.name).toBe("bare");
    expect(result.description).toBe("");
    expect(result.argumentHint).toBe("");
    expect(result.body).toBe("Just some text.\n");
  });

  test("returns empty string body for empty content after frontmatter", () => {
    writeFileSync(join(tmpBase, "empty.md"), "---\n---\n");
    const result = parseSnippet(join(tmpBase, "empty.md"), "user");
    expect(result.body).toBe("");
  });

  test("only description in frontmatter leaves argumentHint empty", () => {
    writeFileSync(
      join(tmpBase, "desc.md"),
      "---\ndescription: Only desc\n---\nBody text.\n",
    );
    const result = parseSnippet(join(tmpBase, "desc.md"), "user");
    expect(result.description).toBe("Only desc");
    expect(result.argumentHint).toBe("");
    expect(result.body).toBe("Body text.");
  });
});

describe("expandPositional", () => {
  test("replaces $1, $2", () => {
    expect(expandPositional("hello $1 and $2", ["world", "mars"])).toBe(
      "hello world and mars",
    );
  });

  test("replaces $ARGUMENTS with all args joined", () => {
    expect(expandPositional("all: $ARGUMENTS", ["a", "b", "c"])).toBe(
      "all: a b c",
    );
  });

  test("replaces $@ with all args joined", () => {
    expect(expandPositional("all: $@", ["x", "y"])).toBe("all: x y");
  });

  test("replaces ${@:2} from second arg onward", () => {
    expect(expandPositional("rest: ${@:2}", ["a", "b", "c"])).toBe("rest: b c");
  });

  test("replaces ${@:2:3} taking three args from second position", () => {
    expect(expandPositional("slice: ${@:2:3}", ["a", "b", "c", "d", "e"])).toBe(
      "slice: b c d",
    );
  });

  test("out-of-range positional args become empty string", () => {
    expect(expandPositional("$1 $2 $3", ["only-one"])).toBe("only-one  ");
  });

  test("mixed variable types in one template", () => {
    expect(
      expandPositional("first=$1 rest=${@:2} all=$ARGUMENTS", ["a", "b", "c"]),
    ).toBe("first=a rest=b c all=a b c");
  });

  test("no args replaces all variables with empty", () => {
    expect(expandPositional("$1 $2 $ARGUMENTS ${@:2}", [])).toBe("   ");
  });
});

describe("expandSnippet", () => {
  const stub: Snippet = {
    name: "t",
    filePath: "",
    description: "",
    argumentHint: "",
    body: "$1 $2",
    source: "user",
  };

  test("splits rawArgs by whitespace", () => {
    expect(expandSnippet(stub, "hello world")).toBe("hello world");
  });

  test("empty rawArgs produces empty args", () => {
    const s: Snippet = { ...stub, body: "no vars $1" };
    expect(expandSnippet(s, "")).toBe("no vars ");
    expect(expandSnippet(s, "   ")).toBe("no vars ");
  });
});

describe("discoverSnippets", () => {
  test("merges snippets from multiple sources", () => {
    const agentDir = join(tmpBase, "agent");
    const cwd = join(tmpBase, "project");
    mkdirSync(join(agentDir, "snippets"), { recursive: true });
    mkdirSync(join(cwd, ".pi", "snippets"), { recursive: true });
    writeFileSync(join(agentDir, "snippets", "a.md"), "user snippet a");
    writeFileSync(join(cwd, ".pi", "snippets", "b.md"), "project snippet b");

    const result = discoverSnippets(cwd, agentDir);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.name).sort()).toEqual(["a", "b"]);
  });

  test("higher-priority source overrides same-name snippet", () => {
    const agentDir = join(tmpBase, "agent");
    const cwd = join(tmpBase, "project");
    mkdirSync(join(agentDir, "snippets"), { recursive: true });
    mkdirSync(join(cwd, ".pi", "snippets"), { recursive: true });
    writeFileSync(join(agentDir, "snippets", "review.md"), "user version");
    writeFileSync(join(cwd, ".pi", "snippets", "review.md"), "project version");

    const result = discoverSnippets(cwd, agentDir);
    expect(result).toHaveLength(1);
    expect(result[0].body).toBe("project version");
    expect(result[0].source).toBe("project");
  });

  test("returns empty array when no dirs exist", () => {
    const result = discoverSnippets(
      join(tmpBase, "no-cwd"),
      join(tmpBase, "no-agent"),
    );
    expect(result).toEqual([]);
  });
});

function createMockPi() {
  return {
    registerCommand: vi.fn(),
    sendUserMessage: vi.fn(),
  } as unknown as ExtensionAPI;
}

function getCommandHandler(pi: ExtensionAPI) {
  return (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0][1];
}

function createMockCtx(overrides: Partial<ExtensionCommandContext> = {}) {
  return {
    cwd: tmpBase,
    ui: { notify: vi.fn() },
    isIdle: () => true,
    ...overrides,
  } as unknown as ExtensionCommandContext;
}

describe("registerSnippetCommand handler", () => {
  test("/snippet list with no snippets shows create hint", () => {
    const pi = createMockPi();
    registerSnippetCommand(pi);

    const handler = getCommandHandler(pi);
    const ctx = createMockCtx();
    handler.handler("list", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("No snippets found"),
      "info",
    );
  });

  test("/snippet list with snippets outputs formatted list", () => {
    mkdirSync(join(tmpBase, ".pi", "agent", "snippets"), { recursive: true });
    writeFileSync(
      join(tmpBase, ".pi", "agent", "snippets", "review.md"),
      "---\ndescription: Review code\n---\nbody",
    );

    const pi = createMockPi();
    registerSnippetCommand(pi);

    const handler = getCommandHandler(pi);
    const ctx = createMockCtx();
    handler.handler("list", ctx);
    const notifyCall = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(notifyCall[1]).toBe("info");
    expect(notifyCall[0]).toContain("review");
    expect(notifyCall[0]).toContain("Review code");
    expect(notifyCall[0]).toContain("1 snippet");
  });

  test("/snippet <unknown> shows not found error", () => {
    const pi = createMockPi();
    registerSnippetCommand(pi);

    const handler = getCommandHandler(pi);
    const ctx = createMockCtx();
    handler.handler("nonexistent", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
      "error",
    );
  });

  test("/snippet <name> when busy shows warning", () => {
    mkdirSync(join(tmpBase, ".pi", "agent", "snippets"), { recursive: true });
    writeFileSync(
      join(tmpBase, ".pi", "agent", "snippets", "test.md"),
      "hello $1",
    );

    const pi = createMockPi();
    registerSnippetCommand(pi);

    const handler = getCommandHandler(pi);
    const ctx = createMockCtx({ isIdle: () => false });
    handler.handler("test", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("busy"),
      "warning",
    );
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  test("/snippet <name> when idle sends expanded message", () => {
    mkdirSync(join(tmpBase, ".pi", "agent", "snippets"), { recursive: true });
    writeFileSync(
      join(tmpBase, ".pi", "agent", "snippets", "test.md"),
      "hello $1",
    );

    const pi = createMockPi();
    registerSnippetCommand(pi);

    const handler = getCommandHandler(pi);
    const ctx = createMockCtx();
    handler.handler("test world", ctx);
    expect(pi.sendUserMessage).toHaveBeenCalledWith("hello world");
  });
});
