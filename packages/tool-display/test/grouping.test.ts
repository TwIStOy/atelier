import { fileURLToPath } from "node:url";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { initTheme, type ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type * as Common from "@htwang-contrib/common";
import { registerAggregateRule, resetAggregateRulesForTest } from "@htwang-contrib/common/aggregate-rules";
import { componentRendersLines } from "@htwang-contrib/common/component-tree";
import {
  isThoughtGroupExpanded,
  isThoughtMemberClaimed,
  setThoughtMember,
  setThoughtMemberClaimed,
} from "@htwang-contrib/common/tool-rail";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
import {
  bumpRoleMutation,
  type GroupRole,
  groupRoleSummary,
  isGroupExpanded,
  resolveGroupRole,
  setGroupExpanded,
} from "../src/grouping.ts";
import extension from "../src/index.ts";
import type { ToolExecutionPatchThis } from "../src/types.ts";
import { fakeThoughtMember, fakeTransparentThought, makeComponent, textBlock, withResult } from "./helpers.ts";

const mockConfig = vi.hoisted(() => ({ overrides: {} as Record<string, unknown> }));

vi.mock("@htwang-contrib/common/config", async (importOriginal) => {
  const actual = await importOriginal<typeof Common>();
  return {
    ...actual,
    readConfig: (_name: string, schema: { defaults: Record<string, unknown> }) => ({
      ...schema.defaults,
      ...mockConfig.overrides,
    }),
    registerConfigItems: vi.fn(),
  };
});

vi.mock("@htwang-contrib/common/extension-disable", async (importOriginal) => {
  const actual = await importOriginal<typeof Common>();
  return {
    ...actual,
    isExtensionDisabled: () => false,
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

type FakeRoot = { children: unknown[] };

function newRoot(): FakeRoot {
  return { children: [] };
}

function roleOf(component: ToolExecutionComponent, width = 80): GroupRole | undefined {
  return resolveGroupRole(component as unknown as ToolExecutionPatchThis, width);
}

function memberLike(toolName: string, opts: { partial?: boolean; error?: boolean } = {}): ToolExecutionPatchThis {
  return {
    toolName,
    isPartial: opts.partial ?? false,
    result: opts.error ? { isError: true } : undefined,
  } as ToolExecutionPatchThis;
}

describe("resolveGroupRole: Member claiming", () => {
  it("claims consecutive rule-registered tools into one verb-group span", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    const grep1 = withResult(makeComponent("grep", root));
    root.children.push(read1, read2, grep1);

    expect(roleOf(read1)).toEqual({ role: "verb-leader", members: [read1, read2, grep1], groupExpanded: false });
    expect(roleOf(read2)).toEqual({ role: "claimed", groupExpanded: false });
    expect(roleOf(grep1)).toEqual({ role: "claimed", groupExpanded: false });
  });

  it("merges interleaved types into one span in first-appearance order", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const grep1 = withResult(makeComponent("grep", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, grep1, read2);

    const role = roleOf(read1);
    expect(role?.role).toBe("verb-leader");
    if (role?.role === "verb-leader") expect(role.members).toEqual([read1, grep1, read2]);
  });

  it("leaves a singleton span ungrouped", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    root.children.push(read1);

    expect(roleOf(read1)).toBeUndefined();
  });

  it("claims tools that registered an Aggregate Rule through common", () => {
    registerAggregateRule("my_probe", {
      verb: "Probed",
      singular: "target",
      plural: "targets",
      progressive: "Probing…",
    });
    const root = newRoot();
    const probe1 = withResult(makeComponent("my_probe", root));
    const probe2 = withResult(makeComponent("my_probe", root));
    root.children.push(probe1, probe2);

    expect(roleOf(probe1)).toMatchObject({ role: "verb-leader", groupExpanded: false });
    expect(roleOf(probe2)).toEqual({ role: "claimed", groupExpanded: false });
  });
});

describe("resolveGroupRole: Break", () => {
  it("breaks the span on assistant text and user message siblings", () => {
    for (const lines of [["assistant text"], ["  user message"]]) {
      const root = newRoot();
      const read1 = withResult(makeComponent("read", root));
      const read2 = withResult(makeComponent("read", root));
      root.children.push(read1, textBlock(lines), read2);

      expect(roleOf(read1)).toBeUndefined();
      expect(roleOf(read2)).toBeUndefined();
    }
  });

  it("breaks the span on a tool without an Aggregate Rule", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const bash1 = withResult(makeComponent("bash", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, bash1, read2);

    expect(roleOf(read1)).toBeUndefined();
    expect(roleOf(bash1)).toBeUndefined();
    expect(roleOf(read2)).toBeUndefined();
  });

  it("bounds the Region at hard breaks on both sides", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    const grep1 = withResult(makeComponent("grep", root));
    const grep2 = withResult(makeComponent("grep", root));
    root.children.push(textBlock(["before"]), read1, read2, textBlock(["middle"]), grep1, grep2, textBlock(["after"]));

    expect(roleOf(read1)).toEqual({ role: "verb-leader", members: [read1, read2], groupExpanded: false });
    expect(roleOf(grep1)).toEqual({ role: "verb-leader", members: [grep1, grep2], groupExpanded: false });
  });
});

describe("resolveGroupRole: Transparent", () => {
  it("skips zero-line siblings without breaking the span", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, textBlock([]), read2);

    expect(roleOf(read1)).toEqual({ role: "verb-leader", members: [read1, read2], groupExpanded: false });
  });

  it("folds across a streaming thinking block without claiming it", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const streaming = fakeTransparentThought();
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, streaming, read2);

    expect(roleOf(read1)).toEqual({ role: "verb-leader", members: [read1, read2], groupExpanded: false });
    expect(isThoughtMemberClaimed(streaming)).toBe(false);
  });

  it("keeps a standalone expanded tool out of a neighboring group", () => {
    const root = newRoot();
    const stray = withResult(makeComponent("read", root));
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(stray, read1, read2);
    stray.setExpanded(true);

    expect(roleOf(stray)).toBeUndefined();
    expect(roleOf(read1)).toEqual({ role: "verb-leader", members: [read1, read2], groupExpanded: false });
  });

  it("does not recurse when a sibling probes this tool from its own render", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    const probing = {
      render: (width: number) => (componentRendersLines(read1, width) ? ["     ◆ Thought for 3s"] : []),
    };
    root.children.push(probing, read1, read2);

    expect(roleOf(read1)).toEqual({ role: "verb-leader", members: [read1, read2], groupExpanded: false });
  });
});

describe("resolveGroupRole: ThoughtMember", () => {
  it("claims an eligible thought between two members", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const thought = fakeThoughtMember();
    const grep1 = withResult(makeComponent("grep", root));
    root.children.push(read1, thought, grep1);

    expect(roleOf(read1)).toEqual({ role: "verb-leader", members: [read1, grep1], groupExpanded: false });
    expect(isThoughtMemberClaimed(thought)).toBe(true);
    expect(isThoughtGroupExpanded(thought)).toBe(false);
  });

  it("leaves a leading or trailing thought outside the span unclaimed", () => {
    const root = newRoot();
    const leading = fakeThoughtMember();
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    const trailing = fakeThoughtMember();
    root.children.push(leading, read1, read2, trailing);

    expect(isThoughtMemberClaimed(leading)).toBe(false);
    expect(isThoughtMemberClaimed(trailing)).toBe(false);
  });

  it("releases the claim once the block gains body text and breaks the Region", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const thought = fakeThoughtMember();
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, thought, read2);

    expect(roleOf(read1)).toMatchObject({ role: "verb-leader" });
    expect(isThoughtMemberClaimed(thought)).toBe(true);

    // Simulate the assistant appending body text: compact-thinking clears the
    // member stamp and the block renders rows again, so it turns into a Break.
    setThoughtMember(thought, false);
    setThoughtMemberClaimed(thought, false);
    (thought as { render: (width: number) => string[] }).render = () => ["assistant text"];
    bumpRoleMutation();

    expect(isThoughtMemberClaimed(thought)).toBe(false);
    expect(roleOf(read1)).toBeUndefined();
    expect(roleOf(read2)).toBeUndefined();
  });

  it("marks thoughts as group-expanded while their group is expanded", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const claimed = fakeThoughtMember();
    const streaming = fakeTransparentThought();
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, claimed, streaming, read2);
    setGroupExpanded(read1, true);
    bumpRoleMutation();

    expect(roleOf(read1)).toMatchObject({ role: "verb-leader", groupExpanded: true });
    expect(isThoughtGroupExpanded(claimed)).toBe(true);
    expect(isThoughtGroupExpanded(streaming)).toBe(true);
  });
});

describe("resolveGroupRole: group expansion", () => {
  it("keeps an expanded leader heading its expanded group", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, read2);
    setGroupExpanded(read1, true);
    read1.setExpanded(true);
    bumpRoleMutation();

    expect(roleOf(read1)).toEqual({ role: "verb-leader", members: [read1, read2], groupExpanded: true });
  });

  it("keeps an individually expanded member inside an expanded span", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    const read3 = withResult(makeComponent("read", root));
    root.children.push(read1, read2, read3);
    setGroupExpanded(read1, true);
    read2.setExpanded(true);
    bumpRoleMutation();

    expect(roleOf(read1)).toEqual({ role: "verb-leader", members: [read1, read2, read3], groupExpanded: true });
    expect(roleOf(read2)).toEqual({ role: "claimed", groupExpanded: true });
  });

  it("drops an individually expanded member from a collapsed span", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    const read3 = withResult(makeComponent("read", root));
    root.children.push(read1, read2, read3);
    read2.setExpanded(true);
    bumpRoleMutation();

    expect(roleOf(read1)).toEqual({ role: "verb-leader", members: [read1, read3], groupExpanded: false });
    expect(roleOf(read2)).toBeUndefined();
  });
});

describe("group expansion state", () => {
  it("tracks expansion per leader", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));

    expect(isGroupExpanded(read1)).toBe(false);
    setGroupExpanded(read1, true);
    expect(isGroupExpanded(read1)).toBe(true);
    expect(isGroupExpanded(read2)).toBe(false);
    setGroupExpanded(read1, false);
    expect(isGroupExpanded(read1)).toBe(false);
  });
});

describe("resolveGroupRole: truncation", () => {
  it("keeps every collapsed tool visible at exactly groupMaxVisible + 1", () => {
    const { groupMaxVisible } = loadConfig();
    const root = newRoot();
    const tools = Array.from({ length: groupMaxVisible + 1 }, () => withResult(makeComponent("bash", root)));
    root.children.push(...tools);

    for (const tool of tools) {
      expect(roleOf(tool)).toBeUndefined();
    }
  });

  it("hides the oldest entries once the run exceeds groupMaxVisible + 1", () => {
    const { groupMaxVisible } = loadConfig();
    const root = newRoot();
    const tools = Array.from({ length: groupMaxVisible + 2 }, () => withResult(makeComponent("bash", root)));
    root.children.push(...tools);

    expect(roleOf(tools[0])).toEqual({ role: "truncation-leader", hidden: [tools[0], tools[1]] });
    expect(roleOf(tools[1])).toEqual({ role: "claimed", groupExpanded: false });
    for (const tool of tools.slice(2)) {
      expect(roleOf(tool)).toBeUndefined();
    }
  });

  it("collects mixed-kind leftovers into one truncation run", () => {
    const { groupMaxVisible } = loadConfig();
    const root = newRoot();
    const bash1 = withResult(makeComponent("bash", root));
    const edit1 = withResult(makeComponent("edit", root));
    const rest = Array.from({ length: groupMaxVisible }, () => withResult(makeComponent("bash", root)));
    root.children.push(bash1, edit1, ...rest);

    expect(roleOf(bash1)).toEqual({ role: "truncation-leader", hidden: [bash1, edit1] });
    expect(roleOf(edit1)).toEqual({ role: "claimed", groupExpanded: false });
  });

  it("does not truncate when groupMaxVisible is 0", () => {
    mockConfig.overrides = { groupMaxVisible: 0 };
    const root = newRoot();
    const tools = Array.from({ length: 12 }, () => withResult(makeComponent("bash", root)));
    root.children.push(...tools);

    for (const tool of tools) {
      expect(roleOf(tool)).toBeUndefined();
    }
  });

  it("keeps streaming members visible at the run tail as the run grows", () => {
    const { groupMaxVisible } = loadConfig();
    const root = newRoot();
    const finished = Array.from({ length: groupMaxVisible + 1 }, () => withResult(makeComponent("bash", root)));
    const streaming = makeComponent("bash", root);
    root.children.push(...finished, streaming);

    expect(roleOf(finished[0])).toEqual({ role: "truncation-leader", hidden: [finished[0], finished[1]] });
    expect(roleOf(streaming)).toBeUndefined();
  });

  it("splits the run at a streaming thinking block", () => {
    const { groupMaxVisible } = loadConfig();
    const root = newRoot();
    const half = Math.ceil((groupMaxVisible + 2) / 2);
    const before = Array.from({ length: half }, () => withResult(makeComponent("bash", root)));
    const after = Array.from({ length: half }, () => withResult(makeComponent("bash", root)));
    root.children.push(...before, fakeTransparentThought(), ...after);

    for (const tool of [...before, ...after]) {
      expect(roleOf(tool)).toBeUndefined();
    }
  });

  it("claims rule-registered leftovers when the verb-group is off", () => {
    mockConfig.overrides = { groupToolVerbs: false };
    const { groupMaxVisible } = loadConfig();
    const root = newRoot();
    const tools = Array.from({ length: groupMaxVisible + 2 }, () => withResult(makeComponent("read", root)));
    root.children.push(...tools);

    expect(roleOf(tools[0])).toEqual({ role: "truncation-leader", hidden: [tools[0], tools[1]] });
  });

  it("renders no verb-group roles when the verb-group is off", () => {
    mockConfig.overrides = { groupToolVerbs: false };
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const grep1 = withResult(makeComponent("grep", root));
    root.children.push(read1, grep1);

    expect(roleOf(read1)).toBeUndefined();
    expect(roleOf(grep1)).toBeUndefined();
  });
});

describe("role memoization", () => {
  it("returns the identical role object for repeated resolves", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, read2);

    expect(roleOf(read1)).toBe(roleOf(read1));
  });

  it("shares one Region computation with every sibling", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, read2);

    const leaderFirst = roleOf(read1);
    expect(roleOf(read2)).toEqual({ role: "claimed", groupExpanded: false });
    expect(roleOf(read1)).toBe(leaderFirst);
  });

  it("recomputes after a role mutation bump", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, read2);

    const first = roleOf(read1);
    read2.setExpanded(true);
    expect(roleOf(read1)).toBe(first);
    bumpRoleMutation();
    expect(roleOf(read1)).not.toBe(first);
    expect(roleOf(read1)).toBeUndefined();
  });

  it("recomputes when the width changes", () => {
    const root = newRoot();
    const read1 = withResult(makeComponent("read", root));
    const read2 = withResult(makeComponent("read", root));
    root.children.push(read1, read2);

    const at80 = roleOf(read1, 80);
    const at120 = roleOf(read1, 120);
    expect(at120).not.toBe(at80);
    expect(at120).toEqual(at80);
    expect(roleOf(read1, 80)).toBe(at80);
  });
});

describe("groupRoleSummary", () => {
  it("signs every role shape for the render-lines cache key", () => {
    expect(groupRoleSummary(undefined)).toBe("none");
    expect(groupRoleSummary({ role: "claimed", groupExpanded: false })).toBe("claimed:shut");
    expect(groupRoleSummary({ role: "claimed", groupExpanded: true })).toBe("claimed:open");
    expect(groupRoleSummary({ role: "truncation-leader", hidden: [memberLike("bash")] })).toBe("trunc:bash");
    expect(
      groupRoleSummary({
        role: "verb-leader",
        members: [memberLike("grep", { partial: true }), memberLike("read", { error: true })],
        groupExpanded: true,
      }),
    ).toBe("lead:open:grepp,reade");
  });
});

describe("patch bridge", () => {
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

  it("bridges the aggregate-rule register event into the common registry", () => {
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
    const root = newRoot();
    const probe1 = withResult(makeComponent("my_probe", root));
    const probe2 = withResult(makeComponent("my_probe", root));
    root.children.push(probe1, probe2);

    expect(roleOf(probe1)).toMatchObject({ role: "verb-leader" });
    expect(roleOf(probe2)).toEqual({ role: "claimed", groupExpanded: false });
  });

  it("ignores left clicks on the truncation header", () => {
    activateExtension();
    const { groupMaxVisible } = loadConfig();
    const root = newRoot();
    const tools = Array.from({ length: groupMaxVisible + 2 }, () => withResult(makeComponent("bash", root)));
    root.children.push(...tools);

    const leader = tools[0] as unknown as {
      expanded: boolean;
      render(width: number): string[];
      handleMouse(event: { type: string; button: string; width: number }): unknown;
    };
    leader.render(80);
    expect(leader.handleMouse({ type: "click", button: "left", width: 80 })).toBeUndefined();
    expect(leader.expanded).toBe(false);
  });
});
