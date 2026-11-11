import type { Theme } from "@earendil-works/pi-coding-agent";
import { type TuiMouseEvent, type TuiMouseEventResult, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type ClickSpan, dispatchClick, spanAt } from "@htwang-contrib/common/tui-click";
import type { PointerTarget } from "../../state/pointer-target.ts";
import type { Clickable } from "../stateful-view.ts";

/**
 * Per-tick projection of TabBar state. The selector
 * (`selectTabBarProps`) hoists every render-time derivation
 * (`allAnswered`, `answered`, `isActive`, `submitActive`) into props so
 * `render()` is pure styling. Replaces the prior `setConfig(TabBarConfig)`
 * snowflake and the inline `+ 1` magic at `props-adapter.ts:127`.
 */
export interface TabBarProps {
  /** One per author-defined question, in order. */
  tabs: ReadonlyArray<{ label: string; answered: boolean; active: boolean }>;
  /** Submit-tab state. `allAnswered` drives the success/dim color picker. */
  submit: { active: boolean; allAnswered: boolean };
}

interface TabPiece {
  text: string;
  target?: PointerTarget;
}

export class TabBar implements Clickable<TabBarProps> {
  private props: TabBarProps;
  private readonly theme: Theme;
  private readonly onPick: (target: PointerTarget) => void;

  constructor(theme: Theme, onPick: (target: PointerTarget) => void) {
    this.theme = theme;
    this.onPick = onPick;
    this.props = { tabs: [], submit: { active: false, allAnswered: false } };
  }

  setProps(props: TabBarProps): void {
    this.props = props;
  }

  handleInput(_data: string): void {}

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    return dispatchClick(
      event,
      (x, y) => (y === 0 ? spanAt(this.layout(event.width).spans, x) : undefined),
      this.onPick,
    );
  }

  invalidate(): void {}

  private tabSegment(tab: TabBarProps["tabs"][number]): string {
    const box = tab.answered ? "■" : "□";
    const rawSeg = ` ${box} ${tab.label} `;
    if (tab.active) {
      return this.theme.bg("selectedBg", this.theme.fg("text", rawSeg));
    }
    return this.theme.fg(tab.answered ? "success" : "muted", rawSeg);
  }

  private submitSegment(): string {
    const submitText = " ✓ Submit ";
    if (this.props.submit.active) {
      return this.theme.bg("selectedBg", this.theme.fg("text", submitText));
    }
    return this.theme.fg(this.props.submit.allAnswered ? "success" : "dim", submitText);
  }

  /**
   * Single source of truth for both painting and hit-testing: pieces in render order,
   * with the inter-tab gap folded into the preceding tab's span so a click between two
   * tabs still lands on the one the gap visually belongs to.
   */
  private layout(width: number): { line: string; spans: ClickSpan<PointerTarget>[] } {
    const pieces: TabPiece[] = [{ text: " ← " }];
    this.props.tabs.forEach((tab, index) => {
      pieces.push({ text: `${this.tabSegment(tab)} `, target: { kind: "tab", index } });
    });
    pieces.push({ text: this.submitSegment(), target: { kind: "submit_tab" } });
    pieces.push({ text: " →" });

    const spans: ClickSpan<PointerTarget>[] = [];
    let column = 0;
    let line = "";
    for (const piece of pieces) {
      const pieceWidth = visibleWidth(piece.text);
      if (piece.target && column < width) {
        spans.push({ start: column, end: Math.min(column + pieceWidth, width), target: piece.target });
      }
      line += piece.text;
      column += pieceWidth;
    }
    return { line: truncateToWidth(line, width, ""), spans };
  }

  render(width: number): string[] {
    return [this.layout(width).line, ""];
  }
}
