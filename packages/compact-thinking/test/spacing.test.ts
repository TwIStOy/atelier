import { fileURLToPath } from "node:url";
import type { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import type * as Common from "@htwang-contrib/common";
import { readRailTailSpacing, setRailTailSpacing } from "@htwang-contrib/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activateExtension, makeComponent, makeMessage } from "./harness.ts";

process.env.PI_PACKAGE_DIR = fileURLToPath(
  new URL("../../../node_modules/@earendil-works/pi-coding-agent", import.meta.url),
);
initTheme("dark", false);

const mockConfig = vi.hoisted(() => ({ overrides: {} as Record<string, unknown> }));

vi.mock("@htwang-contrib/common", async (importOriginal) => {
  const actual = await importOriginal<typeof Common>();
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    isExtensionDisabled: () => false,
    readConfig: (_name: string, schema: { defaults: Record<string, unknown> }) => ({
      ...schema.defaults,
      ...mockConfig.overrides,
    }),
    registerConfigItems: vi.fn(),
  };
});

afterEach(() => {
  mockConfig.overrides = {};
});

function renderLines(component: { render(width: number): string[] }): string[] {
  return component.render(80).map((line) => stripTerminalSequences(line).replace(/[ \t]+$/, ""));
}

describe("thinking block spacing", () => {
  it("joins the rail column with no leading blank at spacing 0", () => {
    const session = activateExtension();
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "reasoning" }]));

    const lines = renderLines(component);
    expect(lines).toEqual(["     ◆ Thinking..."]);
    expect(readRailTailSpacing(component)).toBe(0);
    session.shutdown();
  });

  it("keeps one guaranteed blank between text and a thinking block at spacing 0", () => {
    const session = activateExtension();
    const component = makeComponent(
      makeMessage([
        { type: "text", text: "before" },
        { type: "thinking", thinking: "reasoning" },
        { type: "text", text: "after" },
      ]),
    );

    const lines = renderLines(component);
    expect(lines[0]).toBe("");
    expect(lines[1].trim()).toBe("before");
    expect(lines[2]).toBe("");
    expect(lines[3]).toBe("     ◆ Thinking...");
    expect(lines[4]).toBe("");
    expect(lines[5].trim()).toBe("after");
    expect(readRailTailSpacing(component)).toBeUndefined();
    session.shutdown();
  });

  it("drops the leading blank only for thinking-led messages", () => {
    const session = activateExtension();
    const thinkingLed = renderLines(
      makeComponent(
        makeMessage([
          { type: "thinking", thinking: "reasoning" },
          { type: "text", text: "tail" },
        ]),
      ),
    );
    expect(thinkingLed[0]).toBe("     ◆ Thinking...");
    expect(thinkingLed[1]).toBe("");
    expect(thinkingLed[2].trim()).toBe("tail");

    const textLed = renderLines(
      makeComponent(
        makeMessage([
          { type: "text", text: "head" },
          { type: "thinking", thinking: "reasoning" },
        ]),
      ),
    );
    expect(textLed[0]).toBe("");
    expect(textLed[1].trim()).toBe("head");
    expect(textLed[2]).toBe("");
    expect(textLed[3]).toBe("     ◆ Thinking...");
    session.shutdown();
  });

  it("renders adjacent rail lines for consecutive runs split by a tool call", () => {
    const session = activateExtension();
    const component = makeComponent(
      makeMessage([
        { type: "thinking", thinking: "first" },
        { type: "toolCall", id: "t1", name: "bash", arguments: {} },
        { type: "thinking", thinking: "second" },
      ]),
    );

    const lines = renderLines(component);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("     ◆ Thinking...");
    expect(lines[1]).toBe("     ◆ Thinking...");
    session.shutdown();
  });

  it("restores configured blanks around the block at spacing 1", () => {
    mockConfig.overrides = { blockSpacing: 1 };
    const session = activateExtension();
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "reasoning" }]));

    const lines = renderLines(component);
    expect(lines).toEqual(["", "     ◆ Thinking...", ""]);
    expect(readRailTailSpacing(component)).toBe(1);
    session.shutdown();
  });

  it("clamps hand-edited config values into the 0-5 range", () => {
    mockConfig.overrides = { blockSpacing: 99 };
    const session = activateExtension();
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "reasoning" }]));
    const lines = renderLines(component);
    expect(lines.slice(0, 5)).toEqual(["", "", "", "", ""]);
    expect(lines[5]).toBe("     ◆ Thinking...");
    expect(readRailTailSpacing(component)).toBe(5);
    session.shutdown();
  });

  it("clears the rail-tail marker when an error notice follows the run", () => {
    const session = activateExtension();
    const message = makeMessage([{ type: "thinking", thinking: "reasoning" }]);
    (message as { stopReason?: string }).stopReason = "error";
    (message as { errorMessage?: string }).errorMessage = "boom";
    const component = makeComponent(message);

    const lines = renderLines(component);
    expect(lines[lines.length - 1].trim()).toBe("Error: boom");
    expect(readRailTailSpacing(component)).toBeUndefined();
    session.shutdown();
  });

  it("clears the rail-tail marker when thinking renders unhidden", () => {
    const session = activateExtension();
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "reasoning" }]));
    expect(readRailTailSpacing(component)).toBe(0);

    (component as unknown as AssistantMessageComponent).setHideThinkingBlock(false);
    expect(readRailTailSpacing(component)).toBeUndefined();

    (component as unknown as AssistantMessageComponent).setHideThinkingBlock(true);
    expect(readRailTailSpacing(component)).toBe(0);
    session.shutdown();
  });
});

describe("leading blank against the sibling above", () => {
  it("keeps a blank line above the thinking block when the sibling above is a user message", () => {
    const root = { children: [] as unknown[] };
    const session = activateExtension({ tuiRoot: root });
    const userMessage = { render: () => ["> hello"] };
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "reasoning" }]));
    root.children.push(userMessage, component);

    expect(renderLines(component)).toEqual(["", "     ◆ Thinking..."]);
    session.shutdown();
  });

  it("keeps a blank line above the thinking block when the sibling above is plain assistant text", () => {
    const root = { children: [] as unknown[] };
    const session = activateExtension({ tuiRoot: root });
    const textBlock = { render: () => ["some assistant text"] };
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "reasoning" }]));
    root.children.push(textBlock, component);

    expect(renderLines(component)).toEqual(["", "     ◆ Thinking..."]);
    session.shutdown();
  });

  it("joins the rail column without a blank below a rail-tail marked sibling", () => {
    const root = { children: [] as unknown[] };
    const session = activateExtension({ tuiRoot: root });
    const railTail = { render: () => ["     ◆ Thought for 3s"] };
    setRailTailSpacing(railTail, 0);
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "reasoning" }]));
    root.children.push(railTail, component);

    expect(renderLines(component)).toEqual(["     ◆ Thinking..."]);
    session.shutdown();
  });

  it("joins the rail column without a blank below a tool execution", () => {
    const root = { children: [] as unknown[] };
    const session = activateExtension({ tuiRoot: root });
    const tool = new ToolExecutionComponent(
      "bash",
      "call-1",
      { command: "ls" },
      {},
      undefined,
      root as unknown as ConstructorParameters<typeof ToolExecutionComponent>[5],
      process.cwd(),
    );
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "reasoning" }]));
    root.children.push(tool, component);

    expect(renderLines(component)).toEqual(["     ◆ Thinking..."]);
    session.shutdown();
  });

  it("skips siblings that render no lines when deciding the boundary", () => {
    const root = { children: [] as unknown[] };
    const session = activateExtension({ tuiRoot: root });
    const railTail = { render: () => ["     ◆ Thought for 3s"] };
    setRailTailSpacing(railTail, 0);
    const hidden = { render: () => [] };
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "reasoning" }]));
    root.children.push(railTail, hidden, component);

    expect(renderLines(component)).toEqual(["     ◆ Thinking..."]);
    session.shutdown();
  });
});
