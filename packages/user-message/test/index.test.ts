import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { initTheme, SessionManager, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import type * as Common from "@htwang-contrib/common";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { MessageComplexity } from "../src/complexity.ts";
import extension from "../src/index.ts";

const mocks = vi.hoisted(() => ({ classify: vi.fn(), register: vi.fn(), key: "test-key", warn: vi.fn() }));

vi.mock("../src/complexity.ts", async (importOriginal) => ({
  ...(await importOriginal<{ formatMessageComplexity(value: MessageComplexity): string }>()),
  classifyMessageComplexity: mocks.classify,
}));

vi.mock("@htwang-contrib/common/extension-disable", async (importOriginal) => ({
  ...(await importOriginal<typeof Common>()),
  isExtensionDisabled: () => false,
}));

vi.mock("@htwang-contrib/common/log", async (importOriginal) => ({
  ...(await importOriginal<typeof Common>()),
  createLogger: () => ({ warn: mocks.warn }),
}));

vi.mock("@htwang-contrib/common/systemone", async (importOriginal) => ({
  ...(await importOriginal<typeof Common>()),
  loadSystemOneConfig: () => ({ apiKey: mocks.key }),
  registerSystemOneConfigItems: mocks.register,
}));

process.env.PI_PACKAGE_DIR = fileURLToPath(
  new URL("../../../node_modules/@earendil-works/pi-coding-agent", import.meta.url),
);
initTheme("dark", false);

const fg = vi.fn((color: string, text: string) => (color === "muted" ? `\x1b[90m${text}\x1b[39m` : text));
const theme = {
  fg,
  bg: (_color: string, text: string) => text,
  bold: (s: string) => s,
  italic: (s: string) => s,
} as unknown as Theme;

function activate(mode = "tui", session = SessionManager.inMemory("/project")) {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const ui = { children: [] as UserMessageComponent[], requestRender: vi.fn(), invalidate: vi.fn() };
  const ctx = {
    mode,
    sessionManager: session,
    getSystemPrompt: () => "Project instructions and available tools",
    signal: new AbortController().signal,
    ui: {
      theme,
      setWidget: (_name: string, factory: (tui: TUI) => unknown) => factory(ui as unknown as TUI),
    },
  } as unknown as ExtensionContext;
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => handlers.set(event, handler),
    getThinkingLevel: () => "high",
  } as unknown as ExtensionAPI;
  extension(pi);
  const emit = (name: string, event: unknown = {}) => handlers.get(name)?.(event, ctx);
  emit("session_start");
  const component = (text: string) => {
    const value = new UserMessageComponent(text);
    ui.children.push(value);
    return value;
  };
  const startMessage = (content: string, timestamp = 1) => {
    const message = { role: "user" as const, content, timestamp };
    emit("message_start", { message });
    session.appendMessage(message);
    const value = component(content);
    return { message, component: value };
  };
  const context = () => emit("context", { messages: session.buildSessionContext().messages });
  return { emit, ui, session, ctx, component, startMessage, context };
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.key = "test-key";
});

describe("user message complexity annotation", () => {
  test("registers model configuration and refreshes a muted row after the user message", async () => {
    const { emit, ui, startMessage, context } = activate();
    const probabilities = { flash: 0.1, middle: 0.7, flagship: 0.2 };
    let resolve: (value: MessageComplexity) => void = () => {};
    mocks.classify.mockReturnValueOnce(new Promise<MessageComplexity>((done) => (resolve = done)));
    const { message, component } = startMessage("Fix the bug");
    expect(mocks.classify).not.toHaveBeenCalled();
    expect(context()).toBeUndefined();
    expect(component.render(100).join("\n")).not.toContain("flash");
    await vi.waitFor(() => expect(mocks.classify).toHaveBeenCalledTimes(1));
    resolve(probabilities);
    await vi.waitFor(() => expect(ui.requestRender).toHaveBeenCalled());

    const lines = component.render(100);
    expect(lines.at(-2)).toContain("Fix the bug");
    expect(lines.at(-1)).toBe("\x1b[90m  flash 10.0% · middle 70.0% · flagship 20.0%\x1b[39m");
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(message.content).toBe("Fix the bug");
    for (const width of [1, 8, 30, 80]) {
      for (const line of component.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
    emit("message_start", { message });
    context();
    component.render(80);
    expect(mocks.classify).toHaveBeenCalledTimes(1);
    emit("session_shutdown");
  });

  test("does not classify restored components, non-user messages, or messages without credentials", () => {
    const { emit, component, context } = activate();
    component("Restored text").render(80);
    context();
    emit("message_start", { message: { role: "assistant" } });
    mocks.key = "";
    emit("message_start", { message: { role: "user", content: "New text", timestamp: 1 } });
    context();
    expect(mocks.classify).not.toHaveBeenCalled();
    emit("session_shutdown");
  });

  test("aborts pending work and ignores its result after session replacement", async () => {
    const { emit, ui, component, startMessage, context } = activate();
    let resolve: (value: MessageComplexity) => void = () => {};
    mocks.classify.mockReturnValueOnce(new Promise<MessageComplexity>((done) => (resolve = done)));
    startMessage("Pending");
    context();
    await vi.waitFor(() => expect(mocks.classify).toHaveBeenCalled());
    const signal = mocks.classify.mock.calls[0][2] as AbortSignal;
    emit("session_shutdown");
    expect(signal.aborted).toBe(true);
    emit("session_start");
    resolve({ flash: 1, middle: 0, flagship: 0 });
    await new Promise((done) => setImmediate(done));
    expect(component("Pending").render(80).join("\n")).not.toContain("flash");
    expect(ui.requestRender).not.toHaveBeenCalled();
    emit("session_shutdown");
  });

  test("matches Pi's joined text blocks and the visible user text after a skill block", async () => {
    const { emit, ui, session, component, context } = activate();
    mocks.classify.mockResolvedValue({ flash: 0.1, middle: 0.7, flagship: 0.2 });
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "Fix " },
          { type: "text" as const, text: "the bug" },
        ],
        timestamp: 1,
      },
      {
        role: "user" as const,
        content: '<skill name="example" location="/tmp/SKILL.md">\nSkill instructions\n</skill>\n\nReview the change',
        timestamp: 2,
      },
    ];
    for (const message of messages) {
      emit("message_start", { message });
      session.appendMessage(message);
    }
    context();
    await vi.waitFor(() => expect(ui.requestRender).toHaveBeenCalledTimes(2));
    expect(component("Fix the bug").render(100).at(-1)).toContain("middle 70.0%");
    expect(component("Review the change").render(100).at(-1)).toContain("middle 70.0%");
    expect(mocks.classify.mock.calls.map(([text]) => text)).toEqual(["Fix the bug", "Review the change"]);
    emit("session_shutdown");
  });

  test("leaves the message intact when assessment fails", async () => {
    const { emit, startMessage, context } = activate();
    mocks.classify.mockRejectedValueOnce(new Error("API unavailable"));
    const { component } = startMessage("Keep this text");
    context();
    await vi.waitFor(() => expect(mocks.warn).toHaveBeenCalled());
    const lines = component.render(80).join("\n");
    expect(lines).toContain("Keep this text");
    expect(lines).not.toContain("flash");
    emit("session_shutdown");
  });

  test("does not assess messages in non-TUI modes", () => {
    const { emit, context } = activate("print");
    emit("message_start", { message: { role: "user", content: "Hello", timestamp: 1 } });
    context();
    expect(mocks.classify).not.toHaveBeenCalled();
    emit("session_shutdown");
  });

  test("captures the full context event and system prompt without blocking or reclassifying tool turns", async () => {
    const { emit, ui, startMessage, ctx } = activate();
    mocks.classify.mockResolvedValueOnce({ flash: 0, middle: 0, flagship: 1 });
    const { message } = startMessage("Continue");
    const messages = [
      { role: "user" as const, content: "Investigate the distributed transaction race", timestamp: 0 },
      {
        role: "custom" as const,
        customType: "project-context",
        content: "Injected context from an earlier extension",
        display: false,
        timestamp: 0,
      },
      message,
    ];
    const event = { messages };
    expect(emit("context", event)).toBeUndefined();
    const snapshot = structuredClone(messages);
    messages[0].content = "Later mutation";
    await vi.waitFor(() => expect(ui.requestRender).toHaveBeenCalled());
    expect(mocks.classify).toHaveBeenCalledWith(
      "Continue",
      { systemPrompt: ctx.getSystemPrompt(), messages: snapshot },
      expect.any(AbortSignal),
    );
    emit("context", event);
    await new Promise((done) => setImmediate(done));
    expect(mocks.classify).toHaveBeenCalledTimes(1);
    emit("session_shutdown");
  });

  test("keeps repeated text tied to its own context when assessments finish out of order", async () => {
    const session = SessionManager.inMemory("/project");
    session.appendMessage({ role: "user", content: "Continue", timestamp: 0 });
    const { emit, ui, component, startMessage, context } = activate("tui", session);
    const restored = component("Continue");
    let resolveFirst: (value: MessageComplexity) => void = () => {};
    mocks.classify.mockReturnValueOnce(new Promise<MessageComplexity>((done) => (resolveFirst = done)));
    mocks.classify.mockResolvedValueOnce({ flash: 0, middle: 0, flagship: 1 });
    const first = startMessage("Continue", 1).component;
    context();
    await vi.waitFor(() => expect(mocks.classify).toHaveBeenCalledTimes(1));
    const second = startMessage("Continue", 2).component;
    context();
    await vi.waitFor(() => expect(ui.requestRender).toHaveBeenCalledTimes(1));
    expect(second.render(100).at(-1)).toContain("flagship 100.0%");
    expect(first.render(100).join("\n")).not.toContain("flash");
    expect(restored.render(100).join("\n")).not.toContain("flash");
    resolveFirst({ flash: 1, middle: 0, flagship: 0 });
    await vi.waitFor(() => expect(ui.requestRender).toHaveBeenCalledTimes(2));
    expect(first.render(100).at(-1)).toContain("flash 100.0%");
    expect(second.render(100).at(-1)).toContain("flagship 100.0%");
    expect(mocks.classify.mock.calls[0][1].messages).toHaveLength(2);
    expect(mocks.classify.mock.calls[1][1].messages).toHaveLength(3);
    ui.children.length = 0;
    expect(component("Continue").render(100).join("\n")).not.toContain("flash");
    expect(component("Continue").render(100).at(-1)).toContain("flash 100.0%");
    expect(component("Continue").render(100).at(-1)).toContain("flagship 100.0%");
    expect(mocks.classify).toHaveBeenCalledTimes(2);
    emit("session_shutdown");
  });

  test("uses compaction summaries and remaps rows after compaction and tree navigation", async () => {
    const { emit, session, ui, component, startMessage, context } = activate();
    mocks.classify.mockResolvedValue({ flash: 0, middle: 1, flagship: 0 });
    startMessage("Continue", 1);
    context();
    await vi.waitFor(() => expect(ui.requestRender).toHaveBeenCalledTimes(1));
    const branchPoint = session.getLeafId();
    const { message } = startMessage("Continue", 2);
    const keptId = session.getLeafId();
    if (!keptId) throw new Error("Missing user entry");
    session.appendCompaction("Earlier context summary", keptId, 10000);
    context();
    await vi.waitFor(() => expect(ui.requestRender).toHaveBeenCalledTimes(2));
    expect(mocks.classify.mock.calls[1][1].messages).toEqual([
      expect.objectContaining({ role: "compactionSummary", summary: "Earlier context summary" }),
      message,
    ]);
    emit("session_compact");
    ui.children.length = 0;
    expect(component("Continue").render(100).at(-1)).toContain("middle 100.0%");
    if (!branchPoint) throw new Error("Missing branch point");
    session.branch(branchPoint);
    emit("session_tree");
    ui.children.length = 0;
    expect(component("Continue").render(100).at(-1)).toContain("middle 100.0%");
    expect(mocks.classify).toHaveBeenCalledTimes(2);
    emit("session_shutdown");
  });

  test("turn cancellation aborts classification without rendering a late result", async () => {
    const { emit, ui, ctx, startMessage, context } = activate();
    const controller = new AbortController();
    Object.assign(ctx, { signal: controller.signal });
    let resolve: (value: MessageComplexity) => void = () => {};
    mocks.classify.mockReturnValueOnce(new Promise<MessageComplexity>((done) => (resolve = done)));
    startMessage("Continue");
    context();
    await vi.waitFor(() => expect(mocks.classify).toHaveBeenCalled());
    controller.abort();
    expect(mocks.classify.mock.calls[0][2].aborted).toBe(true);
    resolve({ flash: 1, middle: 0, flagship: 0 });
    await new Promise((done) => setImmediate(done));
    expect(ui.requestRender).not.toHaveBeenCalled();
    emit("session_shutdown");
  });
});

describe("user message rendering", () => {
  test("reuses rendered lines for unchanged content and width", () => {
    const { emit, component } = activate();
    const message = component("Cache this message");
    const first = message.render(80);
    expect(message.render(80)).toBe(first);
    emit("session_shutdown");
  });

  test("re-renders when the width changes or the component is invalidated", () => {
    const { emit, component } = activate();
    const message = component("Cache this message");
    const wide = message.render(80);
    const narrow = message.render(40);
    expect(narrow).not.toBe(wide);
    expect(message.render(40)).toBe(narrow);
    message.invalidate();
    expect(message.render(40)).not.toBe(narrow);
    expect(message.render(40)).toEqual(narrow);
    emit("session_shutdown");
  });
});
