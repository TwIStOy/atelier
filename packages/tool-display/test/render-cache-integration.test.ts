import { fileURLToPath } from "node:url";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type * as Common from "@htwang-contrib/common";
import { resetAggregateRulesForTest } from "@htwang-contrib/common";
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

function withResult(component: ToolExecutionComponent): ToolExecutionComponent {
  component.updateResult({ content: [{ type: "text", text: "done" }], details: {}, isError: false }, false);
  return component;
}

type PatchedComponent = {
  expanded: boolean;
  setExpanded(expanded: boolean): void;
  render(width: number): string[];
};

function asPatched(component: ToolExecutionComponent): PatchedComponent {
  return component as unknown as PatchedComponent;
}

describe("patched render caching", () => {
  it("returns the identical lines array while nothing changed", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const bash = withResult(makeComponent("bash", root));
    root.children.push(bash);

    const first = asPatched(bash).render(80);
    const second = asPatched(bash).render(80);
    expect(second).toBe(first);
  });

  it("re-renders after a result update bumps the component state", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const bash = withResult(makeComponent("bash", root));
    root.children.push(bash);

    const first = asPatched(bash).render(80);
    bash.updateResult({ content: [{ type: "text", text: "changed\nmore" }], details: {}, isError: false }, false);
    const second = asPatched(bash).render(80);
    expect(second).not.toBe(first);
    expect(second).not.toEqual(first);
  });

  it("re-renders when expanded toggles", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const bash = withResult(makeComponent("bash", root));
    root.children.push(bash);

    const first = asPatched(bash).render(80);
    asPatched(bash).setExpanded(true);
    const second = asPatched(bash).render(80);
    expect(second).not.toBe(first);
  });

  it("re-renders when the width changes", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const bash = withResult(makeComponent("bash", root));
    root.children.push(bash);

    const first = asPatched(bash).render(80);
    const second = asPatched(bash).render(120);
    expect(second).not.toBe(first);
  });

  it("keeps returning cached lines for an unchanged sibling when a neighbor updates", () => {
    activateExtension();
    const root: FakeRoot = { children: [] };
    const first1 = withResult(makeComponent("bash", root));
    const second = withResult(makeComponent("bash", root));
    root.children.push(first1, second);

    const firstLines = asPatched(first1).render(80);
    asPatched(second).render(80);
    second.updateResult({ content: [{ type: "text", text: "changed" }], details: {}, isError: false }, false);
    asPatched(second).render(80);

    expect(asPatched(first1).render(80)).toBe(firstLines);
  });
});
