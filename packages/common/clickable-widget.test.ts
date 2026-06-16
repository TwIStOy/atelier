import { describe, expect, test, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import {
  createClickableWidget,
  parseSgrMouseEvents,
  isMouseInput,
  renderClickableRows,
  ENABLE_SGR_MOUSE,
  DISABLE_SGR_MOUSE,
} from "./clickable-widget.ts";

function sgr(button: number, col: number, row: number, press = true): string {
  return `\x1b[<${button};${col};${row}${press ? "M" : "m"}`;
}

describe("parseSgrMouseEvents", () => {
  test("parses a plain left-click press", () => {
    const ev = parseSgrMouseEvents(sgr(0, 5, 10))[0]!;
    expect(ev).toMatchObject({
      button: 0,
      col: 5,
      row: 10,
      type: "press",
      shift: false,
      alt: false,
      ctrl: false,
    });
  });

  test("parses a release event", () => {
    const ev = parseSgrMouseEvents(sgr(0, 1, 1, false))[0]!;
    expect(ev.type).toBe("release");
  });

  test("strips modifier bits from the button number", () => {
    const shift = 0 | 4;
    const ctrl = 0 | 16;
    const alt = 0 | 8;
    const all = 2 | 4 | 8 | 16;
    expect(parseSgrMouseEvents(sgr(shift, 1, 1))[0]!.shift).toBe(true);
    expect(parseSgrMouseEvents(sgr(ctrl, 1, 1))[0]!.ctrl).toBe(true);
    expect(parseSgrMouseEvents(sgr(alt, 1, 1))[0]!.alt).toBe(true);
    const ev = parseSgrMouseEvents(sgr(all, 1, 1))[0]!;
    expect(ev.button).toBe(2);
    expect(ev.shift && ev.alt && ev.ctrl).toBe(true);
  });

  test("parses multiple events in one data chunk", () => {
    const data = sgr(0, 1, 1) + sgr(0, 2, 2);
    expect(parseSgrMouseEvents(data)).toHaveLength(2);
  });

  test("ignores non-mouse data", () => {
    expect(parseSgrMouseEvents("hello\x1b[Ap")).toEqual([]);
  });
});

describe("isMouseInput", () => {
  test("true for SGR mouse sequence", () => {
    expect(isMouseInput(sgr(0, 1, 1))).toBe(true);
  });

  test("false for plain keys", () => {
    expect(isMouseInput("\x1b[A")).toBe(false);
    expect(isMouseInput("abc")).toBe(false);
    expect(isMouseInput("")).toBe(false);
  });
});

describe("renderClickableRows", () => {
  test("assigns contiguous column ranges per segment", () => {
    const rows = renderClickableRows([
      { segments: [{ text: "[A]" }, { text: " " }, { text: "[B]" }] },
    ]);
    const segs = rows[0]!.segments;
    expect(segs[0]).toMatchObject({ startCol: 0, endCol: 3 });
    expect(segs[1]).toMatchObject({ startCol: 3, endCol: 4 });
    expect(segs[2]).toMatchObject({ startCol: 4, endCol: 7 });
    expect(rows[0]!.line).toBe("[A] [B]");
  });

  test("visibleWidth ignores ANSI styling (CJK counts as 2)", () => {
    const rows = renderClickableRows([
      { segments: [{ text: "\x1b[31m中\x1b[0m" }] },
    ]);
    expect(rows[0]!.width).toBe(2);
    expect(rows[0]!.segments[0]).toMatchObject({ startCol: 0, endCol: 2 });
  });
});

function mockTerminal() {
  const writes: string[] = [];
  return {
    writes,
    terminal: {
      write: (d: string) => void writes.push(d),
      columns: 80,
      rows: 24,
    },
  };
}

function mockTui(): TUI & { children: Component[] } {
  const term = mockTerminal();
  const tui = {
    terminal: term.terminal,
    children: [] as Component[],
    requestRender: vi.fn(),
    stop: vi.fn(),
  } as unknown as TUI & { children: Component[] };
  return tui;
}

function mockCtx(): {
  ctx: ExtensionContext;
  getFactory: () => ((t: TUI) => Component) | undefined;
  getHandler: () =>
    | ((data: string) => { consume?: boolean } | undefined)
    | undefined;
} {
  let factory: ((t: TUI) => Component) | undefined;
  let handler:
    | ((data: string) => { consume?: boolean } | undefined)
    | undefined;
  const ctx = {
    hasUI: true,
    ui: {
      setWidget: vi.fn(
        (_key: string, f: ((t: TUI) => Component) | undefined) => {
          factory = f;
        },
      ),
      onTerminalInput: vi.fn(
        (h: (data: string) => { consume?: boolean } | undefined) => {
          handler = h;
          return () => {
            handler = undefined;
          };
        },
      ),
    },
  } as unknown as ExtensionContext;
  return { ctx, getFactory: () => factory, getHandler: () => handler };
}

function renderAndInstall(
  getFactory: () => ((t: TUI) => Component) | undefined,
  precedingSiblingLines: number,
): TUI & { children: Component[] } {
  const tui = mockTui();
  tui.children = [
    {
      render: () => Array.from({ length: precedingSiblingLines }, () => "x"),
    } as unknown as Component,
  ];
  const factory = getFactory()!;
  const comp = factory(tui);
  tui.children.push(comp);
  comp.render(80);
  return tui;
}

describe("createClickableWidget", () => {
  test("controller wires setWidget on attach", () => {
    const { ctx } = mockCtx();
    const handle = createClickableWidget(ctx, {
      key: "test",
      placement: "belowEditor",
      rows: () => [{ segments: [{ text: "x" }] }],
    });
    expect(ctx.ui.setWidget).toHaveBeenCalledTimes(1);
    handle.detach();
  });

  test("enableMouse writes the SGR enable sequence; disable restores", () => {
    const { ctx, getFactory } = mockCtx();
    const writes: string[] = [];
    const handle = createClickableWidget(ctx, {
      key: "test",
      rows: () => [{ segments: [{ text: "x" }] }],
      autoEnableMouse: false,
    });
    const tui = mockTui();
    (tui.terminal as unknown as { write: (s: string) => void }).write = (
      s: string,
    ) => writes.push(s);
    tui.children = [];
    const comp = getFactory()!(tui);
    tui.children.push(comp);
    handle.enableMouse();
    expect(writes).toContain(ENABLE_SGR_MOUSE);
    handle.disableMouse();
    expect(writes).toContain(DISABLE_SGR_MOUSE);
    handle.detach();
  });

  test("clicking a segment fires its onClick and consumes the event", () => {
    const { ctx, getFactory, getHandler } = mockCtx();
    const clicked = vi.fn();
    const handle = createClickableWidget(ctx, {
      key: "test",
      rows: () => [{ segments: [{ text: "[ok]", onClick: clicked }] }],
      autoEnableMouse: false,
    });
    // widget starts after 2 sibling lines -> screenStartRow = 2, segment spans cols 1-4
    const tui = renderAndInstall(getFactory, 2);
    void tui;
    const handler = getHandler()!;
    const result = handler(sgr(0, 2, 3));
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ consume: true });
    handle.detach();
  });

  test("clicking outside any clickable segment does not consume", () => {
    const { ctx, getFactory, getHandler } = mockCtx();
    const clicked = vi.fn();
    const handle = createClickableWidget(ctx, {
      key: "test",
      rows: () => [
        { segments: [{ text: "    " }, { text: "[ok]", onClick: clicked }] },
      ],
      autoEnableMouse: false,
    });
    renderAndInstall(getFactory, 0);
    // col 2 lands on the non-clickable leading spaces
    expect(getHandler()!(sgr(0, 2, 1))).toBeUndefined();
    expect(clicked).not.toHaveBeenCalled();
    handle.detach();
  });

  test("click on a row outside the widget bounds does not consume", () => {
    const { ctx, getFactory, getHandler } = mockCtx();
    const clicked = vi.fn();
    const handle = createClickableWidget(ctx, {
      key: "test",
      rows: () => [{ segments: [{ text: "[ok]", onClick: clicked }] }],
      autoEnableMouse: false,
    });
    renderAndInstall(getFactory, 5);
    // widget is at screen rows 6-6; row 3 is above it
    expect(getHandler()!(sgr(0, 1, 3))).toBeUndefined();
    expect(clicked).not.toHaveBeenCalled();
    handle.detach();
  });

  test("non-mouse input passes through unconsumed", () => {
    const { ctx, getFactory, getHandler } = mockCtx();
    const handle = createClickableWidget(ctx, {
      key: "test",
      rows: () => [{ segments: [{ text: "x" }] }],
      autoEnableMouse: false,
    });
    renderAndInstall(getFactory, 0);
    expect(getHandler()!("\x1b[A")).toBeUndefined();
    expect(getHandler()!("a")).toBeUndefined();
    handle.detach();
  });

  test("detach writes disable sequence and clears widget", () => {
    const { ctx, getFactory } = mockCtx();
    const writes: string[] = [];
    const handle = createClickableWidget(ctx, {
      key: "test",
      rows: () => [{ segments: [{ text: "x" }] }],
      autoEnableMouse: false,
    });
    const tui = renderAndInstall(getFactory, 0);
    (tui.terminal as unknown as { write: (s: string) => void }).write = (
      s: string,
    ) => writes.push(s);
    handle.enableMouse();
    handle.detach();
    expect(ctx.ui.setWidget).toHaveBeenLastCalledWith("test", undefined, {
      placement: "aboveEditor",
    });
    expect(writes).toContain(DISABLE_SGR_MOUSE);
  });
});

describe("exported mouse control sequences", () => {
  test("ENABLE ends with ?1006h, DISABLE restores both", () => {
    expect(ENABLE_SGR_MOUSE).toBe("\x1b[?1000h\x1b[?1006h");
    expect(DISABLE_SGR_MOUSE).toBe("\x1b[?1006l\x1b[?1000l");
  });
});
