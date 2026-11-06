import { fileURLToPath } from "node:url";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import type * as Common from "@htwang-contrib/common";
import { isThoughtMember, isThoughtTransparent, setThoughtMemberClaimed } from "@htwang-contrib/common/tool-rail";
import { describe, expect, it, vi } from "vitest";
import { activateExtension, click, emitAssistantUpdate, makeComponent, makeMessage } from "./harness.ts";

process.env.PI_PACKAGE_DIR = fileURLToPath(
  new URL("../../../node_modules/@earendil-works/pi-coding-agent", import.meta.url),
);
initTheme("dark", false);

vi.mock("@htwang-contrib/common/component-tree", async (importOriginal) => importOriginal<typeof Common>());

vi.mock("@htwang-contrib/common/config", async (importOriginal) => {
  const actual = await importOriginal<typeof Common>();
  return {
    ...actual,
    readConfig: (_name: string, schema: { defaults: Record<string, unknown> }) => ({ ...schema.defaults }),
    registerConfigItems: vi.fn(),
  };
});

vi.mock("@htwang-contrib/common/extension-disable", async (importOriginal) => {
  const actual = await importOriginal<typeof Common>();
  return { ...actual, isExtensionDisabled: () => false };
});

vi.mock("@htwang-contrib/common/frame-epoch", async (importOriginal) => importOriginal<typeof Common>());

vi.mock("@htwang-contrib/common/log", async (importOriginal) => {
  const actual = await importOriginal<typeof Common>();
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock("@htwang-contrib/common/model-resolve", async (importOriginal) => importOriginal<typeof Common>());
vi.mock("@htwang-contrib/common/session-cache", async (importOriginal) => importOriginal<typeof Common>());
vi.mock("@htwang-contrib/common/tool-rail", async (importOriginal) => importOriginal<typeof Common>());

function renderLines(component: { render(width: number): string[] }): string[] {
  return component.render(80).map((line) => stripTerminalSequences(line).replace(/[ \t]+$/, ""));
}

describe("thought member classification", () => {
  it("marks a finished, collapsed, text-free thinking message as eligible but keeps its heading", () => {
    const session = activateExtension();
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "reasoning" }]));

    expect(isThoughtMember(component)).toBe(true);
    expect(isThoughtTransparent(component)).toBe(false);
    expect(renderLines(component)).toEqual(["     ◆ Thinking..."]);
    session.shutdown();
  });

  it("renders zero lines once a verb-group claims the member", () => {
    const session = activateExtension();
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "reasoning" }]));

    setThoughtMemberClaimed(component, true);
    expect(renderLines(component)).toEqual([]);
    session.shutdown();
  });

  it("clears a stale claim on the next content rebuild", () => {
    const session = activateExtension();
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "reasoning" }]));
    setThoughtMemberClaimed(component, true);
    expect(renderLines(component)).toEqual([]);

    (component as unknown as { updateContent(message: unknown): void }).updateContent(
      makeMessage([{ type: "thinking", thinking: "reasoning" }]),
    );
    expect(renderLines(component)).toEqual(["     ◆ Thinking..."]);
    session.shutdown();
  });

  it("does not mark a message with visible text", () => {
    const session = activateExtension();
    const component = makeComponent(
      makeMessage([
        { type: "thinking", thinking: "reasoning" },
        { type: "text", text: "answer" },
      ]),
    );

    expect(isThoughtMember(component)).toBe(false);
    expect(isThoughtTransparent(component)).toBe(false);
    expect(renderLines(component).length).toBeGreaterThan(0);
    session.shutdown();
  });

  it("marks the actively streaming thinking message transparent, not eligible", () => {
    const session = activateExtension();
    const message = makeMessage([{ type: "thinking", thinking: "reasoning" }]);
    emitAssistantUpdate(session, message, { type: "thinking_start", contentIndex: 0 });
    const component = makeComponent(message);

    expect(isThoughtMember(component)).toBe(false);
    expect(isThoughtTransparent(component)).toBe(true);
    expect(renderLines(component).length).toBeGreaterThan(0);
    session.shutdown();
  });

  it("marks a user-expanded run transparent after streaming finishes", () => {
    const session = activateExtension();
    const message = makeMessage([{ type: "thinking", thinking: "l1\nl2\nl3\nl4" }]);
    emitAssistantUpdate(session, message, { type: "thinking_start", contentIndex: 0 });
    const component = makeComponent(message);

    expect(click(component, 0, component.render(80).length)).toMatchObject({ handled: true });
    emitAssistantUpdate(session, message, { type: "text_start", contentIndex: 1 });

    expect(isThoughtMember(component)).toBe(false);
    expect(isThoughtTransparent(component)).toBe(true);
    expect(renderLines(component).length).toBeGreaterThan(0);
    session.shutdown();
  });

  it("does not mark a message carrying an error notice", () => {
    const session = activateExtension();
    const message = makeMessage([{ type: "thinking", thinking: "reasoning" }]);
    (message as { stopReason?: string }).stopReason = "error";
    (message as { errorMessage?: string }).errorMessage = "boom";
    const component = makeComponent(message);

    expect(isThoughtMember(component)).toBe(false);
    expect(isThoughtTransparent(component)).toBe(false);
    expect(renderLines(component).join("\n")).toContain("Error: boom");
    session.shutdown();
  });

  it("clears the marker when thinking renders unhidden", () => {
    const session = activateExtension();
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "reasoning" }]));
    expect(isThoughtMember(component)).toBe(true);

    (component as unknown as { setHideThinkingBlock(hide: boolean): void }).setHideThinkingBlock(false);
    expect(isThoughtMember(component)).toBe(false);
    session.shutdown();
  });
});
