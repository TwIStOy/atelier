import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import type * as Common from "@htwang-contrib/common";
import { getConfigItems } from "@htwang-contrib/common/config";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { BashAssessment } from "../src/bash-assessment.ts";
import extension from "../src/index.ts";

const mocks = vi.hoisted(() => ({
  assess: vi.fn(),
  warn: vi.fn(),
  modelAvailable: true,
  bashAssessment: true,
}));

vi.mock("../src/bash-assessment.ts", async (importOriginal) => ({
  ...(await importOriginal<{ formatBashAssessment(value: BashAssessment): string }>()),
  assessBashCommand: mocks.assess,
}));

vi.mock("@htwang-contrib/common/config", async (importOriginal) => ({
  ...(await importOriginal<typeof Common>()),
  readConfig: (_name: string, schema: { defaults: Record<string, unknown> }) => ({
    ...schema.defaults,
    bashAssessment: mocks.bashAssessment,
    classifierModel: "magpie/jev-latest",
  }),
}));

vi.mock("@htwang-contrib/common/extension-disable", async (importOriginal) => ({
  ...(await importOriginal<typeof Common>()),
  isExtensionDisabled: () => false,
}));

vi.mock("@htwang-contrib/common/log", async (importOriginal) => ({
  ...(await importOriginal<typeof Common>()),
  createLogger: () => ({ warn: mocks.warn }),
}));

process.env.PI_PACKAGE_DIR = fileURLToPath(
  new URL("../../../node_modules/@earendil-works/pi-coding-agent", import.meta.url),
);
initTheme("dark", false);

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

const classifierModel = {
  type: "classifier",
  api: "typesafe-system-one",
  provider: "magpie",
  id: "jev-latest",
  name: "jev-latest",
  baseUrl: "http://gateway.invalid/v1",
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_768,
};

function activate(mode = "tui") {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const root = { children: [] as unknown[], requestRender: vi.fn(), invalidate: vi.fn() };
  const ctx = {
    mode,
    cwd: "/project",
    signal: new AbortController().signal,
    modelRegistry: {
      getModelsOfType: (type: string) => (type === "classifier" ? [classifierModel] : []),
      getModelOfType: (type: string, provider: string, id: string) =>
        mocks.modelAvailable && type === "classifier" && provider === "magpie" && id === "jev-latest"
          ? classifierModel
          : undefined,
      classify: vi.fn(),
    },
    ui: {
      theme,
      setWidget: (_name: string, factory: (tui: TUI) => unknown) => factory(root as unknown as TUI),
    },
  } as unknown as ExtensionContext;
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => handlers.set(event, handler),
    events: { on: vi.fn(), emit: vi.fn() },
  } as unknown as ExtensionAPI;
  extension(pi);
  const emit = (name: string, event: unknown = {}) => handlers.get(name)?.(event, ctx);
  emit("session_start");
  const component = (id: string, args: { command: string; description?: string }) => {
    const tool = new ToolExecutionComponent("bash", id, args, {}, undefined, root as unknown as TUI, "/project");
    tool.updateResult({ content: [{ type: "text", text: "first\nsecond\n" }], details: {}, isError: false }, false);
    root.children.push(tool);
    return tool;
  };
  return { emit, component, root, ctx };
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.modelAvailable = true;
  mocks.bashAssessment = true;
});

describe("Bash header assessment annotation", () => {
  test("returns immediately without changing the tool call and appends scores after the output count", async () => {
    const { emit, component, root } = activate();
    let resolve: (value: BashAssessment) => void = () => {};
    mocks.assess.mockReturnValueOnce(new Promise<BashAssessment>((done) => (resolve = done)));
    const args = { command: "printf 'first\\nsecond\\n'", description: "Print lines" };
    const tool = component("bash-1", args);
    const event = { toolName: "bash", toolCallId: "bash-1", input: args };
    expect(emit("tool_call", event)).toBeUndefined();
    expect(tool.render(120).join("\n")).not.toContain("destructive");
    await vi.waitFor(() => expect(mocks.assess).toHaveBeenCalledTimes(1));
    resolve({ destructive: 0.9, exfiltration: 0.8 });
    await vi.waitFor(() => expect(root.requestRender).toHaveBeenCalled());

    expect(tool.render(120).join("\n")).toContain("Ran Print lines · 2 lines · destructive 90.0% · exfiltration 80.0%");
    expect(event.input).toEqual(args);
    const setting = getConfigItems("tool-display").find((item) => item.key === "classifierModel");
    expect(setting).toMatchObject({ type: "select", label: "Classifier Model" });
    expect(mocks.assess.mock.calls[0][0]).toBe(args.command);
    expect(mocks.assess.mock.calls[0][1]).toBe("/project");
    for (const width of [1, 20, 50, 80]) {
      for (const line of tool.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
    emit("tool_call", event);
    expect(mocks.assess).toHaveBeenCalledTimes(1);
    emit("session_shutdown");
  });

  test("keeps scores attached to their IDs when concurrent calls complete out of order", async () => {
    const { emit, component, root } = activate();
    let resolveFirst: (value: BashAssessment) => void = () => {};
    mocks.assess.mockReturnValueOnce(new Promise<BashAssessment>((done) => (resolveFirst = done)));
    mocks.assess.mockResolvedValueOnce({ destructive: 0.2, exfiltration: 0.3 });
    const first = component("first", { command: "same command" });
    const second = component("second", { command: "same command" });
    for (const id of ["first", "second"]) {
      emit("tool_call", { toolName: "bash", toolCallId: id, input: { command: "same command" } });
    }
    await vi.waitFor(() => expect(root.requestRender).toHaveBeenCalledTimes(1));
    expect(first.render(120).join("\n")).not.toContain("destructive");
    expect(second.render(120).join("\n")).toContain("destructive 20.0% · exfiltration 30.0%");
    resolveFirst({ destructive: 0.7, exfiltration: 0.6 });
    await vi.waitFor(() => expect(root.requestRender).toHaveBeenCalledTimes(2));
    expect(first.render(120).join("\n")).toContain("destructive 70.0% · exfiltration 60.0%");
    expect(second.render(120).join("\n")).toContain("destructive 20.0% · exfiltration 30.0%");
    emit("session_shutdown");
  });

  test("keeps line counts and scores visible by clipping a long description", async () => {
    const { emit, component, root } = activate();
    mocks.assess.mockResolvedValueOnce({ destructive: 0.01, exfiltration: 0.02 });
    const args = { command: "echo test", description: "Long description ".repeat(20) };
    const tool = component("long", args);
    emit("tool_call", { toolName: "bash", toolCallId: "long", input: args });
    await vi.waitFor(() => expect(root.requestRender).toHaveBeenCalled());
    const header = tool.render(100).at(-1);
    expect(header).toContain("…");
    expect(header).toContain("· 2 lines · destructive 1.0% · exfiltration 2.0%");
    expect(visibleWidth(header ?? "")).toBeLessThanOrEqual(100);
    tool.setExpanded(true);
    expect(tool.render(100).join("\n")).toContain("destructive 1.0% · exfiltration 2.0%");
    emit("session_shutdown");
  });

  test("assessment failures do not mark a successful tool as failed", async () => {
    const { emit, component } = activate();
    mocks.assess.mockRejectedValueOnce(new Error("Service unavailable"));
    const tool = component("failed-assessment", { command: "echo test" });
    expect(
      emit("tool_call", { toolName: "bash", toolCallId: "failed-assessment", input: { command: "echo test" } }),
    ).toBeUndefined();
    await vi.waitFor(() => expect(mocks.warn).toHaveBeenCalled());
    expect(tool.render(120).join("\n")).toContain("Ran echo test · 2 lines");
    expect(tool.render(120).join("\n")).not.toContain("destructive");
    emit("session_shutdown");
  });

  test("preserves the full command when the scores need a header continuation line", async () => {
    const { emit, component, root } = activate();
    mocks.assess.mockResolvedValueOnce({ destructive: 0.01, exfiltration: 0.02 });
    const args = { command: "npm run build --workspace packages/common --foreground-scripts --loglevel verbose" };
    const tool = component("wrapped", args);
    emit("tool_call", { toolName: "bash", toolCallId: "wrapped", input: args });
    await vi.waitFor(() => expect(root.requestRender).toHaveBeenCalled());
    const lines = tool.render(80);
    expect(lines.join(" ").replaceAll("┃", "").replace(/\s+/g, "")).toContain(args.command.replace(/\s+/g, ""));
    expect(lines.join("\n")).toContain("· 2 lines · destructive 1.0% · exfiltration 2.0%");
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(80);
    emit("session_shutdown");
  });

  test("aborts pending assessment on session shutdown and discards late results", async () => {
    const { emit, component, root } = activate();
    let resolve: (value: BashAssessment) => void = () => {};
    mocks.assess.mockReturnValueOnce(new Promise<BashAssessment>((done) => (resolve = done)));
    const tool = component("pending", { command: "echo test" });
    emit("tool_call", { toolName: "bash", toolCallId: "pending", input: { command: "echo test" } });
    await vi.waitFor(() => expect(mocks.assess).toHaveBeenCalled());
    const signal = mocks.assess.mock.calls[0][2] as AbortSignal;
    emit("session_shutdown");
    expect(signal.aborted).toBe(true);
    emit("session_start");
    resolve({ destructive: 1, exfiltration: 1 });
    await new Promise((done) => setImmediate(done));
    expect(root.requestRender).not.toHaveBeenCalled();
    expect(tool.render(120).join("\n")).not.toContain("destructive");
    emit("session_shutdown");
  });

  test("skips restored tools, non-bash tools, and calls without an available classifier model", () => {
    const { emit, component } = activate();
    component("restored", { command: "echo restored" }).render(80);
    emit("tool_call", { toolName: "read", input: { path: "test" } });
    mocks.modelAvailable = false;
    emit("tool_call", { toolName: "bash", toolCallId: "new", input: { command: "echo new" } });
    expect(mocks.assess).not.toHaveBeenCalled();
    emit("session_shutdown");
  });

  test("does not assess Bash calls outside TUI mode", () => {
    const { emit } = activate("print");
    emit("tool_call", { toolName: "bash", toolCallId: "new", input: { command: "echo new" } });
    expect(mocks.assess).not.toHaveBeenCalled();
    emit("session_shutdown");
  });

  test("does not block or warn when the classifier model is not registered", () => {
    const { emit } = activate();
    mocks.modelAvailable = false;
    expect(
      emit("tool_call", { toolName: "bash", toolCallId: "no-model", input: { command: "echo test" } }),
    ).toBeUndefined();
    expect(mocks.assess).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
    emit("session_shutdown");
  });

  test("disabling assessments skips requests and hides cached scores without changing tool output", async () => {
    const { emit, component, root } = activate();
    mocks.assess.mockResolvedValueOnce({ destructive: 0.1, exfiltration: 0.2 });
    const tool = component("assessed", { command: "echo test" });
    emit("tool_call", { toolName: "bash", toolCallId: "assessed", input: { command: "echo test" } });
    await vi.waitFor(() => expect(root.requestRender).toHaveBeenCalled());
    expect(tool.render(120).join("\n")).toContain("destructive 10.0%");
    const setting = getConfigItems("tool-display").find((item) => item.key === "bashAssessment");
    expect(setting).toMatchObject({ type: "boolean", label: "Bash Assessments" });
    if (typeof setting?.value !== "function") throw new Error("Missing Bash assessment setting getter");
    expect(setting.value()).toBe(true);
    mocks.bashAssessment = false;
    expect(setting.value()).toBe(false);
    mocks.modelAvailable = false;
    const next = component("disabled", { command: "echo next" });
    expect(
      emit("tool_call", { toolName: "bash", toolCallId: "disabled", input: { command: "echo next" } }),
    ).toBeUndefined();
    await new Promise((done) => setImmediate(done));
    expect(mocks.assess).toHaveBeenCalledTimes(1);
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(tool.render(120).join("\n")).toContain("Ran echo test · 2 lines");
    expect(tool.render(120).join("\n")).not.toMatch(/destructive|exfiltration/);
    expect(next.render(120).join("\n")).not.toMatch(/destructive|exfiltration/);
    tool.setExpanded(true);
    const expanded = tool.render(120).join("\n");
    expect(expanded).toContain("first");
    expect(expanded).toContain("second");
    expect(expanded).not.toMatch(/destructive|exfiltration/);
    mocks.bashAssessment = true;
    expect(tool.render(120).join("\n")).toContain("destructive 10.0% · exfiltration 20.0%");
    emit("session_shutdown");
  });

  test("does not display a pending assessment that finishes after the setting is disabled", async () => {
    const { emit, component, root } = activate();
    let resolve: (value: BashAssessment) => void = () => {};
    mocks.assess.mockReturnValueOnce(new Promise<BashAssessment>((done) => (resolve = done)));
    const tool = component("pending", { command: "echo test" });
    emit("tool_call", { toolName: "bash", toolCallId: "pending", input: { command: "echo test" } });
    await vi.waitFor(() => expect(mocks.assess).toHaveBeenCalled());
    mocks.bashAssessment = false;
    resolve({ destructive: 1, exfiltration: 1 });
    await vi.waitFor(() => expect(root.requestRender).toHaveBeenCalled());
    expect(tool.render(120).join("\n")).not.toMatch(/destructive|exfiltration/);
    emit("session_shutdown");
  });
});
