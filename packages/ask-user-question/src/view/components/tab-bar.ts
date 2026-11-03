import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { StatefulView } from "../stateful-view.ts";

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

export class TabBar implements StatefulView<TabBarProps> {
  private props: TabBarProps;

  constructor(private readonly theme: Theme) {
    this.props = { tabs: [], submit: { active: false, allAnswered: false } };
  }

  setProps(props: TabBarProps): void {
    this.props = props;
  }

  handleInput(_data: string): void {}

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

  render(width: number): string[] {
    const pieces: string[] = [" ← "];

    for (const tab of this.props.tabs) {
      pieces.push(this.tabSegment(tab));
      pieces.push(" ");
    }

    pieces.push(this.submitSegment());
    pieces.push(" →");

    const tabLine = truncateToWidth(pieces.join(""), width, "");
    return [tabLine, ""];
  }
}
