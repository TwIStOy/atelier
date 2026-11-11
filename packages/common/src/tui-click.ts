import type { TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";

/** Column range `[start, end)` within one rendered row that resolves to `target`. */
export interface ClickSpan<T> {
  start: number;
  end: number;
  target: T;
}

/** Target of the first span containing column `x`, or `undefined` for a click-through cell. */
export function spanAt<T>(spans: readonly ClickSpan<T>[], x: number): T | undefined {
  for (const span of spans) {
    if (x >= span.start && x < span.end) return span.target;
  }
  return undefined;
}

/**
 * Two-phase click handling for a pi-tui component.
 *
 * pi synthesizes the `click` event (a release that did not move) only when the
 * matching `press` was claimed by a component, so a clickable region must claim
 * presses and act on clicks. Claiming a press returns `{ render: false }`: nothing
 * changed yet, and an unrequested render would repaint on every mouse-down.
 *
 * Repeated clicks are ignored (`clickCount > 1`): a double click on a toggle row
 * would otherwise flip it back, and the action already ran on the first click.
 *
 * Events reach components in fullscreen mode only; regular mode leaves pointer input
 * to the terminal, so every clickable region still needs a keyboard path.
 */
export function dispatchClick<T>(
  event: TuiMouseEvent,
  resolve: (x: number, y: number) => T | undefined,
  pick: (target: T) => void,
): TuiMouseEventResult | undefined {
  if (event.button !== "left" || (event.type !== "press" && event.type !== "click")) return undefined;
  if ((event.clickCount ?? 1) > 1) return undefined;
  const target = resolve(event.x, event.y);
  if (target === undefined) return undefined;
  if (event.type === "press") return { handled: true, render: false };
  pick(target);
  return { handled: true };
}
