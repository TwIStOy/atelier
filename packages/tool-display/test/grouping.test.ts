import { fileURLToPath } from "node:url";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type * as Common from "@htwang-contrib/common";
import {
  isThoughtMemberClaimed,
  registerAggregateRule,
  resetAggregateRulesForTest,
  setThoughtMember,
  setThoughtMemberClaimed,
  setThoughtTransparent,
} from "@htwang-contrib/common";
import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.ts";

const mockConfig = vi.hoisted(() => ({ overrides: {} as Record<string, unknown> }));

vi.mock("@htwang-contrib/common", async (importOriginal) => {
  const actual = await importOriginal<typeof Common>();
  return {
    ...actual,
    isExtensionDisabled: () => false,
    readConfig: (_name: string, schema: { defaults: Record<string, unknown> }) => ({
      ...schema.defaults,
      ...mockConfig.overrides,
    }),
    registerConfigItems: vi.fn(),
  };
});

process.env.PI_PACKAGE_DIR = fileURLToPath(
  new URL("../../../node_modules/@earendil-works/pi-coding-agent", import.meta.url),
);
initTheme("dark", false);

const PLAIN_THEME: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
} as Theme;

afterEach(() => {
  mockConfig.overrides = {};
  resetAggregateRulesForTest();
});

function activateExtension(): void {
  const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => void>>();
  const pi = {
    events: { on: vi.fn(), emit: vi.fn() },
    on: vi.fn((name: string, handler: (event: unknown, ctx: unknown) => void) => {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    }),
  };
  extension(pi as unknown as ExtensionAPI);
  const sessionStart = handlers.get("session_start")?.[0];
  if (!sessionStart) throw new Error("session_start handler not registered");
  sessionStart(undefined, { mode: "tui", ui: { theme: PLAIN_THEME } });
}

type FakeRoot = { children: unknown[] };

let callSeq = 0;

function makeComponent(toolName: string, root: FakeRoot): ToolExecutionComponent {
  const toolDefinition: ToolDefinition = {
    name: toolName,
    label: toolName,
    description: "test tool",
    parameters: Type.Object({}),
    execute: async () => ({ content: [], details: {} }),
  };
  return new ToolExecutionComponent(
    toolName,
    `call-${toolName}-${callSeq++}`,
    {},
    {},
    toolDefinition,
    root as unknown as ConstructorParameters<typeof ToolExecutionComponent>[5],
    process.cwd(),
  );
}

function withResult(component: ToolExecutionComponent, isError = false): ToolExecutionComponent {
  component.updateResult({ content: [{ type: "text", text: isError ? "boom" : "done" }], details: {}, isError }, false);
  return component;
}

function makeTools(toolName: string, count: number, root: FakeRoot): ToolExecutionComponent[] {
  const tools: ToolExecutionComponent[] = [];
  for (let i = 0; i < count; i++) {
    const component = withResult(makeComponent(toolName, root));
    tools.push(component);
    root.children.push(component);
  }
  return tools;
}

function fakeThoughtMember(lines: string[] = ["     ◆ Thought for 5s"]): object {
  const fake = { render: () => lines };
  setThoughtMember(fake, true);
  return fake;
}

function fakeTransparentThought(lines: string[] = ["     ◆ Thinking..."]): object {
  const fake = { render: () => lines };
  setThoughtTransparent(fake, true);
  return fake;
}

type PatchedComponent = {
  expanded: boolean;
  render(width: number): string[];
  handleMouse(event: { type: string; button: string; width: number }): unknown;
};

function asPatched(component: ToolExecutionComponent): PatchedComponent {
  return component as unknown as PatchedComponent;
}

describe("thought member folding", () => {
  it("claims an eligible thought between two member batches into one group", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    const thought = fakeThoughtMember();
    const grep1 = withResult(makeComponent("grep", root));
    root.children.push(read1, thought, grep1);

    expect(asPatched(read1).render(80)).toEqual(["", "  ❙  ◈ Read 1 file, Searched 1 pattern"]);
    expect(isThoughtMemberClaimed(thought)).toBe(true);
    expect(asPatched(grep1).render(80)).toEqual([]);
  });

  it("leaves a leading thought ahead of the first member unclaimed", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const thought = fakeThoughtMember();
    const read1 = withResult(makeComponent("read", root));
    root.children.push(thought, read1);

    asPatched(read1).render(80);
    expect(isThoughtMemberClaimed(thought)).toBe(false);
  });

  it("releases the claim once the group behind it breaks", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    const thought = fakeThoughtMember();
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, thought, read2);

    asPatched(read1).render(80);
    expect(isThoughtMemberClaimed(thought)).toBe(true);

    // Simulate the assistant appending body text to the thinking message:
    // compact-thinking rebuilds content, clears both markers, and the block
    // renders rows again, so the next scan no longer treats it as a thought.
    const textBearing = thought as { render: (width: number) => string[] };
    setThoughtMember(thought, false);
    setThoughtMemberClaimed(thought, false);
    textBearing.render = () => ["assistant text"];

    asPatched(read1).render(80);
    expect(isThoughtMemberClaimed(thought)).toBe(false);
    expect(asPatched(read2).render(80)).toEqual(["", "  ❙  ◈ Read 1 file"]);
  });

  it("folds across a streaming or user-expanded thinking block without claiming it", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    const streaming = fakeTransparentThought();
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, streaming, read2);

    expect(asPatched(read1).render(80)).toEqual(["", "  ❙  ◈ Read 2 files"]);
    expect(isThoughtMemberClaimed(streaming)).toBe(false);
    expect(asPatched(read2).render(80)).toEqual([]);
  });
});

describe("aggregate rule registration", () => {
  it("folds tools with a rule registered through common into the verb-group", () => {
    registerAggregateRule("my_probe", {
      verb: "Probed",
      singular: "target",
      plural: "targets",
      progressive: "Probing…",
    });
    activateExtension();
    const root: FakeRoot = { children: [] };
    const probe1 = withResult(makeComponent("my_probe", root));
    const read1 = withResult(makeComponent("read", root));
    root.children.push(probe1, read1);

    expect(asPatched(probe1).render(80)).toEqual(["", "  ❙  ◈ Probed 1 target, Read 1 file"]);
    expect(asPatched(read1).render(80)).toEqual([]);
  });

  it("bridges the register event into the common registry", () => {
    const events = new Map<string, Array<(data: unknown) => void>>();
    const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => void>>();
    const pi = {
      events: {
        on: vi.fn((name: string, handler: (data: unknown) => void) => {
          const list = events.get(name) ?? [];
          list.push(handler);
          events.set(name, list);
        }),
        emit: vi.fn(),
      },
      on: vi.fn((name: string, handler: (event: unknown, ctx: unknown) => void) => {
        const list = handlers.get(name) ?? [];
        list.push(handler);
        handlers.set(name, list);
      }),
    };
    extension(pi as unknown as ExtensionAPI);
    for (const handler of events.get("tool-display:register-aggregate-rule") ?? []) {
      handler({ toolName: "my_probe", rule: { verb: "Probed", singular: "t", plural: "ts", progressive: "Probing…" } });
    }

    const sessionStart = handlers.get("session_start")?.[0];
    sessionStart?.(undefined, { mode: "tui", ui: { theme: PLAIN_THEME } });
    const root: FakeRoot = { children: [] };
    const probe1 = withResult(makeComponent("my_probe", root));
    root.children.push(probe1);

    expect(asPatched(probe1).render(80)).toEqual(["", "  ❙  ◈ Probed 1 t"]);
  });
});

describe("truncation layer", () => {
  it("keeps every collapsed bash visible at exactly groupMaxVisible + 1", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const tools = makeTools("bash", 11, root);

    for (const tool of tools) {
      expect(asPatched(tool).render(80).join("\n")).toContain("◆");
    }
  });

  it("hides the oldest entries behind a header once the run exceeds groupMaxVisible + 1", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const tools = makeTools("bash", 12, root);

    expect(asPatched(tools[0]).render(80)).toEqual(["", "  ❙  ◈ Ran 2 commands"]);
    expect(asPatched(tools[1]).render(80)).toEqual([]);
    for (const tool of tools.slice(2)) {
      const lines = asPatched(tool).render(80);
      expect(lines.join("\n")).toContain("◆");
      expect(lines.join("\n")).not.toContain("◈");
    }
  });

  it("phrases a uniform edit/write/apply_patch run as Edited N files", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    for (const name of ["edit", "write", "apply_patch"]) {
      makeTools(name, 4, root);
    }
    const first = root.children[0] as ToolExecutionComponent;

    expect(asPatched(first).render(80)).toEqual(["", "  ❙  ◈ Edited 2 files"]);
  });

  it("falls back to N more when the hidden entries mix kinds", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    makeTools("bash", 1, root);
    makeTools("edit", 1, root);
    makeTools("bash", 10, root);
    const first = root.children[0] as ToolExecutionComponent;

    expect(asPatched(first).render(80)).toEqual(["", "  ❙  ◈ 2 more"]);
  });

  it("renders the header red with a failed suffix when a hidden member errored", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const tools = makeTools("bash", 12, root);
    tools[0].updateResult({ content: [{ type: "text", text: "boom" }], details: {}, isError: true }, false);

    expect(asPatched(tools[0]).render(80)).toEqual(["", "  ┃  ◈ Ran 2 commands · 1 failed"]);
  });

  it("does not truncate when groupMaxVisible is 0", () => {
    mockConfig.overrides = { groupMaxVisible: 0 };
    activateExtension();
    const root: FakeRoot = { children: [] };
    const tools = makeTools("bash", 12, root);

    for (const tool of tools) {
      expect(asPatched(tool).render(80).join("\n")).toContain("◆");
    }
  });

  it("ignores left clicks on the truncation header", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const tools = makeTools("bash", 12, root);

    const leader = asPatched(tools[0]);
    leader.render(80);
    expect(leader.handleMouse({ type: "click", button: "left", width: 80 })).toBeUndefined();
    expect(leader.expanded).toBe(false);
  });

  it("keeps rule phrasing for read/grep in the header when the verb-group is off", () => {
    mockConfig.overrides = { groupToolVerbs: false };
    activateExtension();
    const root: FakeRoot = { children: [] };
    const tools = makeTools("read", 12, root);

    expect(asPatched(tools[0]).render(80)).toEqual(["", "  ❙  ◈ Read 2 files"]);
    expect(asPatched(tools[1]).render(80)).toEqual([]);
    const visible = asPatched(tools[11]).render(80).join("\n");
    expect(visible).toContain("◆");
    expect(visible).not.toContain("◈");
  });

  it("renders read/grep as ordinary collapsed rows when the verb-group is off", () => {
    mockConfig.overrides = { groupToolVerbs: false };
    activateExtension();
    const root: FakeRoot = { children: [] };
    const read1 = withResult(makeComponent("read", root));
    const grep1 = withResult(makeComponent("grep", root));
    root.children.push(read1, grep1);

    for (const tool of [read1, grep1]) {
      const lines = asPatched(tool).render(80).join("\n");
      expect(lines).toContain("◆");
      expect(lines).not.toContain("◈");
    }
  });

  it("keeps streaming members visible at the run tail as the run grows", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const tools = makeTools("bash", 11, root);
    const streaming = makeComponent("bash", root);
    root.children.push(streaming);

    expect(asPatched(tools[0]).render(80)).toEqual(["", "  ❙  ◈ Ran 2 commands"]);
    expect(asPatched(streaming).render(80).join("\n")).not.toContain("◈");
    withResult(streaming);
    expect(asPatched(tools[0]).render(80)).toEqual(["", "  ❙  ◈ Ran 2 commands"]);
  });

  it("splits the run at a streaming or user-expanded thinking block", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const before = makeTools("bash", 6, root);
    root.children.push(fakeTransparentThought());
    const after = makeTools("bash", 6, root);

    // Each side is its own 6-participant run, below the truncation threshold.
    for (const tool of [...before, ...after]) {
      const lines = asPatched(tool).render(80).join("\n");
      expect(lines).not.toContain("◈");
    }
  });
});
