import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
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

vi.mock("@htwang-contrib/common", async (importOriginal) => ({
  ...(await importOriginal<typeof Common>()),
  isExtensionDisabled: () => false,
  loadSystemOneConfig: () => ({ apiKey: mocks.key }),
  registerSystemOneConfigItems: mocks.register,
  createLogger: () => ({ warn: mocks.warn }),
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

function activate(mode = "tui") {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const ui = { requestRender: vi.fn(), invalidate: vi.fn() };
  const ctx = {
    mode,
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
  return { emit, ui };
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.key = "test-key";
});

describe("user message complexity annotation", () => {
  test("registers model configuration and refreshes a muted row after the user message", async () => {
    const { emit, ui } = activate();
    const probabilities = { flash: 0.1, middle: 0.7, flagship: 0.2 };
    let resolve: (value: MessageComplexity) => void = () => {};
    mocks.classify.mockReturnValueOnce(new Promise<MessageComplexity>((done) => (resolve = done)));
    const message = { role: "user", content: "Fix the bug", timestamp: 1 };
    const component = new UserMessageComponent(message.content);
    expect(emit("message_start", { message })).toBeUndefined();
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
    component.render(80);
    expect(mocks.classify).toHaveBeenCalledTimes(1);
    emit("session_shutdown");
  });

  test("does not classify restored components, non-user messages, or messages without credentials", () => {
    const { emit } = activate();
    new UserMessageComponent("Restored text").render(80);
    emit("message_start", { message: { role: "assistant" } });
    mocks.key = "";
    emit("message_start", { message: { role: "user", content: "New text", timestamp: 1 } });
    expect(mocks.classify).not.toHaveBeenCalled();
    emit("session_shutdown");
  });

  test("aborts pending work and ignores its result after session replacement", async () => {
    const { emit, ui } = activate();
    let resolve: (value: MessageComplexity) => void = () => {};
    mocks.classify.mockReturnValueOnce(new Promise<MessageComplexity>((done) => (resolve = done)));
    emit("message_start", { message: { role: "user", content: "Pending", timestamp: 1 } });
    await vi.waitFor(() => expect(mocks.classify).toHaveBeenCalled());
    const signal = mocks.classify.mock.calls[0][1] as AbortSignal;
    emit("session_shutdown");
    expect(signal.aborted).toBe(true);
    emit("session_start");
    resolve({ flash: 1, middle: 0, flagship: 0 });
    await new Promise((done) => setImmediate(done));
    expect(new UserMessageComponent("Pending").render(80).join("\n")).not.toContain("flash");
    expect(ui.requestRender).not.toHaveBeenCalled();
    emit("session_shutdown");
  });

  test("matches Pi's joined text blocks and the visible user text after a skill block", async () => {
    const { emit, ui } = activate();
    mocks.classify.mockResolvedValue({ flash: 0.1, middle: 0.7, flagship: 0.2 });
    emit("message_start", {
      message: {
        role: "user",
        content: [
          { type: "text", text: "Fix " },
          { type: "text", text: "the bug" },
        ],
        timestamp: 1,
      },
    });
    emit("message_start", {
      message: {
        role: "user",
        content: '<skill name="example" location="/tmp/SKILL.md">\nSkill instructions\n</skill>\n\nReview the change',
        timestamp: 2,
      },
    });
    await vi.waitFor(() => expect(ui.requestRender).toHaveBeenCalledTimes(2));
    expect(new UserMessageComponent("Fix the bug").render(100).at(-1)).toContain("middle 70.0%");
    expect(new UserMessageComponent("Review the change").render(100).at(-1)).toContain("middle 70.0%");
    expect(mocks.classify.mock.calls.map(([text]) => text)).toEqual(["Fix the bug", "Review the change"]);
    emit("session_shutdown");
  });

  test("leaves the message intact when assessment fails", async () => {
    const { emit } = activate();
    mocks.classify.mockRejectedValueOnce(new Error("API unavailable"));
    emit("message_start", { message: { role: "user", content: "Keep this text", timestamp: 1 } });
    await vi.waitFor(() => expect(mocks.warn).toHaveBeenCalled());
    const lines = new UserMessageComponent("Keep this text").render(80).join("\n");
    expect(lines).toContain("Keep this text");
    expect(lines).not.toContain("flash");
    emit("session_shutdown");
  });

  test("does not assess messages in non-TUI modes", () => {
    const { emit } = activate("print");
    emit("message_start", { message: { role: "user", content: "Hello", timestamp: 1 } });
    expect(mocks.classify).not.toHaveBeenCalled();
    emit("session_shutdown");
  });
});
