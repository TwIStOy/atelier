import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type * as Common from "@htwang-contrib/common";
import { Type } from "@sinclair/typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@htwang-contrib/common", async (importOriginal) => {
  const actual = await importOriginal<typeof Common>();
  return {
    ...actual,
    isExtensionDisabled: () => false,
    registerConfigItems: vi.fn(),
  };
});

const PLAIN_THEME: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
} as Theme;

type PatchedComponent = {
  expanded: boolean;
  result?: unknown;
  render(width: number): string[];
  handleMouse(event: {
    type: string;
    button: string;
    x: number;
    y: number;
    screenX: number;
    screenY: number;
    width: number;
    height: number;
  }): unknown;
  updateResult(result: unknown, isPartial?: boolean): void;
};

let tmpDir: string;
let extension: typeof import("../src/index.ts").default;
let mcpDisplayName: typeof import("../src/mcp.ts").mcpDisplayName;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "tool-display-mcp-"));
  vi.stubEnv("XDG_CONFIG_HOME", tmpDir);
  vi.resetModules();
  const [indexMod, mcpMod] = await Promise.all([import("../src/index.ts"), import("../src/mcp.ts")]);
  extension = indexMod.default;
  mcpDisplayName = mcpMod.mcpDisplayName;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
});

function writeConfig(section: Record<string, unknown>): void {
  const dir = join(tmpDir, "pi");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "extensions.json"), JSON.stringify({ "tool-display": section }));
}

function activateExtension(): void {
  const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => void>>();
  const pi = {
    events: { on: vi.fn(), emit: vi.fn() },
    on: vi.fn((name: string, handler: (event: unknown, ctx: unknown) => void) => {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    }),
    getAllTools: () => [],
  };
  extension(pi as unknown as ExtensionAPI);
  const sessionStart = handlers.get("session_start")?.[0];
  if (!sessionStart) throw new Error("session_start handler not registered");
  sessionStart(undefined, { mode: "tui", ui: { theme: PLAIN_THEME } });
}

async function makeMcpComponent(toolName: string, label: string): Promise<PatchedComponent> {
  const { ToolExecutionComponent } = await import("@earendil-works/pi-coding-agent");
  const toolDefinition: ToolDefinition = {
    name: toolName,
    label,
    description: "mcp tool",
    parameters: Type.Object({}),
    execute: async () => ({ content: [], details: {} }),
    renderCall: () => new Text("mcp-adapter-header"),
    renderResult: () => new Text("mcp-adapter-result"),
    renderShell: "self",
  };
  const fakeUi = undefined as unknown as ConstructorParameters<typeof ToolExecutionComponent>[5];
  return new ToolExecutionComponent(
    toolName,
    "call-1",
    { url: "https://example.com" },
    {},
    toolDefinition,
    fakeUi,
    process.cwd(),
  ) as unknown as PatchedComponent;
}

describe("mcpDisplayName", () => {
  it("uses the label suffix for direct tools", () => {
    expect(mcpDisplayName("chrome_devtools_take_screenshot", "MCP: take_screenshot")).toBe("McpTakeScreenshot");
  });

  it("falls back to Mcp for the proxy tool", () => {
    expect(mcpDisplayName("mcp", "MCP")).toBe("Mcp");
  });

  it("camelizes the tool name when the label is absent", () => {
    expect(mcpDisplayName("chrome_devtools_take_screenshot")).toBe("ChromeDevtoolsTakeScreenshot");
  });
});

describe("patched render for pi-mcp-adapter tools", () => {
  it("renders via the generic rail pattern instead of the adapter's own renderers", async () => {
    activateExtension();
    const component = await makeMcpComponent("chrome_devtools_take_screenshot", "MCP: take_screenshot");
    component.updateResult({ content: [{ type: "text", text: "line one\nline two" }], details: {} }, false);

    const lines = component.render(80);
    const text = lines.join("\n");
    expect(text).not.toContain("mcp-adapter-header");
    expect(text).not.toContain("mcp-adapter-result");
    expect(text).toContain("McpTakeScreenshot");
    expect(text).toContain("2 lines");
  });

  it("renders an errored result as a reason line", async () => {
    activateExtension();
    const component = await makeMcpComponent("chrome_devtools_take_screenshot", "MCP: take_screenshot");
    component.updateResult(
      { content: [{ type: "text", text: "connection refused" }], details: { error: "call_failed" }, isError: true },
      false,
    );

    const text = component.render(80).join("\n");
    expect(text).toContain("connection refused");
  });

  it("toggles expanded on left click", async () => {
    activateExtension();
    const component = await makeMcpComponent("chrome_devtools_take_screenshot", "MCP: take_screenshot");
    component.updateResult({ content: [{ type: "text", text: "done" }], details: {} }, false);

    const event = {
      type: "click",
      button: "left",
      x: 2,
      y: 1,
      screenX: 2,
      screenY: 5,
      width: 80,
      height: 3,
    };
    expect(component.handleMouse(event)).toEqual({ handled: true });
    expect(component.expanded).toBe(true);
  });

  it("leaves rendering to the adapter when mcpToolCalls is disabled", async () => {
    writeConfig({ mcpToolCalls: false });
    activateExtension();
    const component = await makeMcpComponent("chrome_devtools_take_screenshot", "MCP: take_screenshot");
    component.updateResult({ content: [{ type: "text", text: "line one\nline two" }], details: {} }, false);

    const text = component.render(80).join("\n");
    expect(text).toContain("mcp-adapter-header");
    expect(text).not.toContain("McpTakeScreenshot");
  });
});
