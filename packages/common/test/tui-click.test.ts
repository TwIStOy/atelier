import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { dispatchClick, spanAt } from "../src/tui-click.ts";

function event(overrides: Partial<TuiMouseEvent> = {}): TuiMouseEvent {
  return {
    type: "click",
    button: "left",
    x: 0,
    y: 0,
    screenX: 0,
    screenY: 0,
    width: 80,
    height: 10,
    shift: false,
    alt: false,
    ctrl: false,
    ...overrides,
  };
}

describe("spanAt", () => {
  const spans = [
    { start: 0, end: 3, target: "a" },
    { start: 3, end: 6, target: "b" },
  ];

  it("resolves the span containing the column", () => {
    expect(spanAt(spans, 0)).toBe("a");
    expect(spanAt(spans, 2)).toBe("a");
    expect(spanAt(spans, 3)).toBe("b");
    expect(spanAt(spans, 5)).toBe("b");
  });

  it("returns undefined outside every span", () => {
    expect(spanAt(spans, -1)).toBeUndefined();
    expect(spanAt(spans, 6)).toBeUndefined();
    expect(spanAt([], 0)).toBeUndefined();
  });
});

describe("dispatchClick", () => {
  const resolve = (x: number, y: number) => (x === 1 && y === 2 ? "hit" : undefined);

  it("claims a press without acting on it", () => {
    const pick = vi.fn();
    expect(dispatchClick(event({ type: "press", x: 1, y: 2 }), resolve, pick)).toEqual({
      handled: true,
      render: false,
    });
    expect(pick).not.toHaveBeenCalled();
  });

  it("acts on the synthesized click", () => {
    const pick = vi.fn();
    expect(dispatchClick(event({ type: "click", x: 1, y: 2 }), resolve, pick)).toEqual({ handled: true });
    expect(pick).toHaveBeenCalledExactlyOnceWith("hit");
  });

  it("leaves cells without a target click-through", () => {
    const pick = vi.fn();
    expect(dispatchClick(event({ type: "press", x: 0, y: 0 }), resolve, pick)).toBeUndefined();
    expect(dispatchClick(event({ type: "click", x: 0, y: 0 }), resolve, pick)).toBeUndefined();
    expect(pick).not.toHaveBeenCalled();
  });

  it("ignores non-left buttons, drags, moves, releases, and wheels", () => {
    const pick = vi.fn();
    for (const type of ["drag", "move", "release", "wheel"] as const) {
      expect(dispatchClick(event({ type, x: 1, y: 2 }), resolve, pick)).toBeUndefined();
    }
    expect(dispatchClick(event({ button: "right", x: 1, y: 2 }), resolve, pick)).toBeUndefined();
    expect(pick).not.toHaveBeenCalled();
  });

  it("ignores repeat clicks so a double click cannot flip a toggle back", () => {
    const pick = vi.fn();
    expect(dispatchClick(event({ clickCount: 2, x: 1, y: 2 }), resolve, pick)).toBeUndefined();
    expect(pick).not.toHaveBeenCalled();
  });
});
