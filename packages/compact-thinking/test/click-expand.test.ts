import { stripTerminalSequences } from "@earendil-works/pi-tui";
import type * as Common from "@htwang-contrib/common";
import { describe, expect, it, vi } from "vitest";
import { activateExtension, click, makeComponent, makeMessage } from "./harness.ts";

vi.mock("@htwang-contrib/common", async (importOriginal) => {
  const actual = await importOriginal<typeof Common>();
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    isExtensionDisabled: () => false,
    readConfig: (_name: string, schema: { defaults: Record<string, unknown> }) => ({ ...schema.defaults }),
    registerConfigItems: vi.fn(),
  };
});

describe("compact thinking click expansion", () => {
  it("expands and collapses a single thinking run on left click", () => {
    activateExtension();
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "l1\nl2\nl3\nl4\nl5\nl6" }]));

    const collapsed = component.render(80).map(stripTerminalSequences);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].replace(/[ \t]+$/, "")).toBe("     ◆ Thinking...");

    const height = component.render(80).length;
    expect(click(component, 0, height)).toMatchObject({ handled: true });

    const expanded = component.render(80).map(stripTerminalSequences);
    expect(expanded[0].replace(/[ \t]+$/, "")).toBe("  ┃  ◆ Thinking... ... (click to collapse)");
    expect(expanded[1].replace(/[ \t]+$/, "")).toBe("  ┃");
    expect(expanded[2].replace(/[ \t]+$/, "")).toBe("  ┃    l1");
    expect(expanded[expanded.length - 1].replace(/[ \t]+$/, "")).toBe("  ┃    l6");

    expect(click(component, 0, component.render(80).length)).toMatchObject({ handled: true });
    const collapsedAgain = component.render(80).map(stripTerminalSequences);
    expect(collapsedAgain).toHaveLength(1);
    expect(collapsedAgain[0].replace(/[ \t]+$/, "")).toBe("     ◆ Thinking...");
  });

  it("ignores non-left-button and non-click events", () => {
    activateExtension();
    const component = makeComponent(makeMessage([{ type: "thinking", thinking: "l1\nl2" }]));
    const height = component.render(80).length;

    expect(click(component, 0, height, "right")).toBeUndefined();
    expect(
      component.handleMouse({
        type: "wheel",
        button: "none",
        x: 4,
        y: 1,
        screenX: 4,
        screenY: 11,
        width: 80,
        height,
        shift: false,
        alt: false,
        ctrl: false,
        wheelDelta: -3,
      }),
    ).toBeUndefined();
    expect(component.render(80).map(stripTerminalSequences)).toHaveLength(1);
  });

  it("expands only the clicked run", () => {
    activateExtension();
    const component = makeComponent(
      makeMessage([
        { type: "thinking", thinking: "a1\na2\na3\na4" },
        { type: "text", text: "middle" },
        { type: "thinking", thinking: "b1\nb2\nb3\nb4" },
      ]),
    );

    const collapsed = component.render(80).map(stripTerminalSequences);
    expect(collapsed.some((line) => line.replace(/[ \t]+$/, "") === "     ◆ Thinking...")).toBe(true);
    expect(collapsed.some((line) => line.trim() === "a1")).toBe(false);
    expect(collapsed.some((line) => line.trim() === "b1")).toBe(false);

    const height = component.render(80).length;
    expect(click(component, 0, height)).toMatchObject({ handled: true });

    const after = component.render(80).join("\n");
    expect(after).toContain("a1");
    expect(after).not.toContain("b1\n");
  });
});
