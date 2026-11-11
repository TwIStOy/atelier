import type { TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { dispatchClick } from "@htwang-contrib/common/tui-click";
import type { PointerTarget } from "../../state/pointer-target.ts";
import type { Clickable } from "../stateful-view.ts";
import { WrappingSelect, type WrappingSelectItem, type WrappingSelectTheme } from "./wrapping-select.ts";

/**
 * Maximum number of option rows visible in the WrappingSelect window. Lifted here from
 * `preview-pane.ts` so the cap travels with the option-list owner.
 */
const MAX_VISIBLE_OPTIONS = 10;

export interface OptionListViewConfig {
  items: readonly WrappingSelectItem[];
  theme: WrappingSelectTheme;
  /** Reports a click on an option row to the dialog owner. */
  onPick: (target: PointerTarget) => void;
}

/**
 * Per-tick projection of OptionListView state. `inputBuffer`
 * is part of the props bag — the session-owned `inlineEditor` (a headless
 * `pi-tui` Editor instance) supplies its current text here per tick.
 * `OptionListView` is purely props-driven; the imperative buffer surface and
 * read-back getters are gone.
 */
export interface OptionListViewProps {
  selectedIndex: number;
  focused: boolean;
  inputBuffer: string;
  inputCursorOffset?: number;
  /** Optional previously-confirmed indicator. Omit when no marker should be drawn. */
  confirmed?: { index: number; labelOverride?: string };
}

/**
 * Sole owner of the option list's interactive state. Wraps a single
 * `WrappingSelect`. Implements `Clickable<OptionListViewProps>`:
 * `setProps` is the only mutator, render output reflects the last props
 * received, and clicks resolve to item indices through the select's own row math.
 */
export class OptionListView implements Clickable<OptionListViewProps> {
  private readonly select: WrappingSelect;
  private readonly onPick: (target: PointerTarget) => void;

  constructor(config: OptionListViewConfig) {
    this.select = new WrappingSelect(config.items, Math.min(config.items.length, MAX_VISIBLE_OPTIONS), config.theme, {
      numberStartOffset: 0,
      totalItemsForNumbering: config.items.length,
    });
    this.onPick = config.onPick;
  }

  setProps(props: OptionListViewProps): void {
    this.select.setSelectedIndex(props.selectedIndex);
    this.select.setFocused(props.focused);
    this.select.setConfirmedIndex(props.confirmed?.index, props.confirmed?.labelOverride);
    this.select.setInputBuffer(props.inputBuffer);
    this.select.setInputCursorOffset(props.inputCursorOffset);
  }

  handleInput(_data: string): void {}

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    return dispatchClick(
      event,
      (x, y) => this.select.itemAt(x, y, event.width),
      (index) => this.onPick({ kind: "option", index }),
    );
  }

  invalidate(): void {
    this.select.invalidate();
  }

  render(width: number): string[] {
    return this.select.render(width);
  }

  focusedItemRowRange(width: number): [number, number] {
    return this.select.focusedItemRowRange(width);
  }
}
